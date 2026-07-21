import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../features/auth/useAuth';
import { listAreas, listProjects } from '../services/projectService';
import {
  listTechnicalDocuments,
  listTechnicalDocumentVersions,
  setTechnicalDocumentActive,
  uploadTechnicalDocument,
  validateTechnicalDocumentFile,
  type TechnicalDocumentUploadHandle,
} from '../services/technicalDocumentService';
import type { Area, Project } from '../types/project';
import {
  technicalDocumentCategories,
  technicalDocumentCategoryLabels,
  type TechnicalDocument,
  type TechnicalDocumentCategory,
  type TechnicalDocumentVersion,
} from '../types/technicalDocument';

interface DocumentFormState {
  projectId: string;
  title: string;
  description: string;
  category: TechnicalDocumentCategory;
  version: string;
  issueDate: string;
  areaIds: string[];
  appliesToAllAreas: boolean;
  active: boolean;
  allowDownload: boolean;
}

const emptyForm: DocumentFormState = {
  projectId: 'p84',
  title: '',
  description: '',
  category: 'drawing',
  version: '1',
  issueDate: '',
  areaIds: [],
  appliesToAllAreas: false,
  active: true,
  allowDownload: true,
};

function sizeLabel(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
}

function dateTimeLabel(version: TechnicalDocumentVersion) {
  const date = version.uploadedAt?.toDate?.();
  return date
    ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date)
    : 'Envio recente';
}

export function AdminDocumentsPage() {
  const { profile } = useAuth();
  const formAnchor = useRef<HTMLDivElement>(null);
  const uploadHandle = useRef<TechnicalDocumentUploadHandle | undefined>(undefined);
  const [projects, setProjects] = useState<Project[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [documents, setDocuments] = useState<TechnicalDocument[]>([]);
  const [form, setForm] = useState<DocumentFormState>(emptyForm);
  const [file, setFile] = useState<File | null>(null);
  const [replacement, setReplacement] = useState<TechnicalDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [expandedVersions, setExpandedVersions] = useState('');
  const [versions, setVersions] = useState<TechnicalDocumentVersion[]>([]);

  async function refreshDocuments(projectId: string) {
    setDocuments(await listTechnicalDocuments(projectId, true));
  }

  useEffect(() => {
    if (!profile) return;
    let active = true;
    void listProjects(profile.projectIds, true)
      .then(async (nextProjects) => {
        if (!active) return;
        const selectedProject =
          nextProjects.find((project) => project.id === 'p84')?.id || nextProjects[0]?.id || '';
        setProjects(nextProjects);
        setForm((current) => ({ ...current, projectId: selectedProject }));
        if (!selectedProject) return;
        const [nextAreas, nextDocuments] = await Promise.all([
          listAreas(selectedProject),
          listTechnicalDocuments(selectedProject, true),
        ]);
        if (!active) return;
        setAreas(nextAreas);
        setDocuments(nextDocuments);
      })
      .catch(() => {
        if (active) setError('Não foi possível carregar os documentos técnicos.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [profile]);

  const filteredDocuments = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR');
    return documents.filter((document) => {
      if (categoryFilter !== 'all' && document.category !== categoryFilter) return false;
      if (!term) return true;
      return [document.title, document.description, document.fileName, document.version].some(
        (value) => value?.toLocaleLowerCase('pt-BR').includes(term),
      );
    });
  }, [categoryFilter, documents, search]);

  async function changeProject(projectId: string) {
    setForm((current) => ({ ...current, projectId, areaIds: [] }));
    setLoading(true);
    setError('');
    try {
      const [nextAreas, nextDocuments] = await Promise.all([
        listAreas(projectId),
        listTechnicalDocuments(projectId, true),
      ]);
      setAreas(nextAreas);
      setDocuments(nextDocuments);
    } catch {
      setError('Não foi possível carregar o projeto selecionado.');
    } finally {
      setLoading(false);
    }
  }

  async function selectFile(nextFile: File | undefined) {
    if (!nextFile) return;
    setError('');
    try {
      await validateTechnicalDocumentFile(nextFile);
      setFile(nextFile);
      if (!form.title && !replacement) {
        setForm((current) => ({ ...current, title: nextFile.name.replace(/\.pdf$/i, '') }));
      }
    } catch (validationError) {
      setFile(null);
      setError(validationError instanceof Error ? validationError.message : 'PDF inválido.');
    }
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    void selectFile(event.dataTransfer.files[0]);
  }

  function toggleArea(areaId: string) {
    setForm((current) => ({
      ...current,
      areaIds: current.areaIds.includes(areaId)
        ? current.areaIds.filter((id) => id !== areaId)
        : [...current.areaIds, areaId],
    }));
  }

  function resetForm() {
    setForm((current) => ({ ...emptyForm, projectId: current.projectId }));
    setFile(null);
    setReplacement(null);
    setProgress(0);
  }

  async function handleUpload() {
    if (!profile || !file) {
      setError('Selecione o arquivo PDF.');
      return;
    }
    if (form.title.trim().length < 2) {
      setError('Informe o título do documento.');
      return;
    }
    if (!form.version.trim()) {
      setError('Informe a versão do documento.');
      return;
    }
    if (!form.appliesToAllAreas && form.areaIds.length === 0) {
      setError('Selecione ao menos uma área ou marque “Todas as áreas”.');
      return;
    }

    setUploading(true);
    setProgress(0);
    setError('');
    setSuccess('');
    try {
      const handle = uploadTechnicalDocument(
        form,
        file,
        profile,
        setProgress,
        replacement || undefined,
      );
      uploadHandle.current = handle;
      const uploaded = await handle.promise;
      setSuccess(
        replacement
          ? `A versão ${uploaded.version} de “${uploaded.title}” foi publicada.`
          : `“${uploaded.title}” foi publicado para os inspetores.`,
      );
      resetForm();
      await refreshDocuments(form.projectId);
    } catch (uploadError) {
      setError(
        uploadError instanceof Error ? uploadError.message : 'Não foi possível enviar o PDF.',
      );
    } finally {
      uploadHandle.current = undefined;
      setUploading(false);
    }
  }

  function startReplacement(document: TechnicalDocument) {
    setReplacement(document);
    setFile(null);
    setForm({
      projectId: document.projectId,
      title: document.title,
      description: document.description || '',
      category: document.category,
      version: document.version,
      issueDate: document.issueDate || '',
      areaIds: document.areaIds,
      appliesToAllAreas: document.appliesToAllAreas,
      active: document.active,
      allowDownload: document.allowDownload,
    });
    setError('');
    setSuccess('');
    formAnchor.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function toggleActive(document: TechnicalDocument) {
    setError('');
    try {
      await setTechnicalDocumentActive(document.id, !document.active);
      await refreshDocuments(document.projectId);
    } catch {
      setError('Não foi possível alterar a disponibilidade do documento.');
    }
  }

  async function toggleVersions(documentId: string) {
    if (expandedVersions === documentId) {
      setExpandedVersions('');
      setVersions([]);
      return;
    }
    setExpandedVersions(documentId);
    setVersions([]);
    try {
      setVersions(await listTechnicalDocumentVersions(documentId));
    } catch {
      setError('Não foi possível carregar o histórico de versões.');
    }
  }

  return (
    <section className="admin-documents-page">
      <Link className="text-link back-link" to="/admin">
        ← Voltar à administração
      </Link>
      <p className="eyebrow">Administração</p>
      <div className="page-heading">
        <h1>Documentos técnicos</h1>
        <span className="badge">PDF · até 50 MB</span>
      </div>
      <p className="page-intro">
        Publique referências por projeto e área. Uma nova versão preserva o histórico do arquivo.
      </p>

      {error && <div className="notice notice-error">{error}</div>}
      {success && <div className="notice notice-success">{success}</div>}

      <section className="admin-section" ref={formAnchor}>
        <div className="admin-section-heading">
          <div>
            <p className="eyebrow">Publicação</p>
            <h2>{replacement ? `Nova versão de ${replacement.title}` : 'Adicionar documento'}</h2>
          </div>
          {replacement && (
            <button className="button button-outline compact-button" onClick={resetForm}>
              Cancelar nova versão
            </button>
          )}
        </div>

        <div className="technical-document-form">
          <label>
            Projeto
            <select
              value={form.projectId}
              disabled={uploading || Boolean(replacement)}
              onChange={(event) => void changeProject(event.target.value)}
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.code} · {project.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Título
            <input
              value={form.title}
              disabled={uploading}
              onChange={(event) =>
                setForm((current) => ({ ...current, title: event.target.value }))
              }
            />
          </label>
          <label>
            Categoria
            <select
              value={form.category}
              disabled={uploading}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  category: event.target.value as TechnicalDocumentCategory,
                }))
              }
            >
              {technicalDocumentCategories.map((category) => (
                <option key={category} value={category}>
                  {technicalDocumentCategoryLabels[category]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Versão
            <input
              value={form.version}
              disabled={uploading}
              placeholder="Ex.: 2.1"
              onChange={(event) =>
                setForm((current) => ({ ...current, version: event.target.value }))
              }
            />
          </label>
          <label>
            Data de emissão
            <input
              type="date"
              value={form.issueDate}
              disabled={uploading}
              onChange={(event) =>
                setForm((current) => ({ ...current, issueDate: event.target.value }))
              }
            />
          </label>
          <label className="document-description-field">
            Descrição
            <textarea
              value={form.description}
              disabled={uploading}
              rows={3}
              onChange={(event) =>
                setForm((current) => ({ ...current, description: event.target.value }))
              }
            />
          </label>
        </div>

        <fieldset className="area-selector" disabled={uploading}>
          <legend>Áreas que poderão acessar</legend>
          <label className="check-option all-areas-option">
            <input
              type="checkbox"
              checked={form.appliesToAllAreas}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  appliesToAllAreas: event.target.checked,
                  areaIds: event.target.checked ? [] : current.areaIds,
                }))
              }
            />
            Todas as áreas do projeto
          </label>
          {!form.appliesToAllAreas && (
            <div className="area-options">
              {areas.map((area) => (
                <label className="check-option" key={area.id}>
                  <input
                    type="checkbox"
                    checked={form.areaIds.includes(area.id)}
                    onChange={() => toggleArea(area.id)}
                  />
                  <span>
                    <strong>{area.code}</strong> {area.name}
                  </span>
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <div className="document-options">
          <label className="check-option">
            <input
              type="checkbox"
              checked={form.active}
              disabled={uploading}
              onChange={(event) =>
                setForm((current) => ({ ...current, active: event.target.checked }))
              }
            />
            Disponível para inspetores
          </label>
          <label className="check-option">
            <input
              type="checkbox"
              checked={form.allowDownload}
              disabled={uploading}
              onChange={(event) =>
                setForm((current) => ({ ...current, allowDownload: event.target.checked }))
              }
            />
            Exibir opção de download
          </label>
        </div>

        <label
          className={`pdf-dropzone ${file ? 'has-file' : ''}`}
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
        >
          <input
            className="visually-hidden"
            type="file"
            accept="application/pdf,.pdf"
            disabled={uploading}
            onChange={(event) => void selectFile(event.target.files?.[0])}
          />
          <span className="pdf-dropzone-icon" aria-hidden="true">
            PDF
          </span>
          <strong>{file ? file.name : 'Selecionar ou arrastar um PDF'}</strong>
          <small>{file ? sizeLabel(file.size) : 'Máximo de 50 MB'}</small>
        </label>

        {uploading && (
          <div className="upload-progress document-upload-progress" aria-label="Progresso do envio">
            <span style={{ width: `${progress}%` }} />
            <small>{progress}% enviado</small>
          </div>
        )}
        <div className="document-form-actions">
          {uploading && (
            <button
              className="button button-outline compact-button"
              onClick={() => uploadHandle.current?.cancel()}
            >
              Cancelar envio
            </button>
          )}
          <button
            className="button button-primary compact-button"
            disabled={uploading || !file}
            onClick={() => void handleUpload()}
          >
            {uploading ? 'Enviando…' : replacement ? 'Publicar nova versão' : 'Publicar documento'}
          </button>
        </div>
      </section>

      <section className="admin-section">
        <div className="admin-section-heading">
          <div>
            <p className="eyebrow">Biblioteca</p>
            <h2>{documents.length} documentos cadastrados</h2>
          </div>
        </div>
        <div className="document-library-tools">
          <label>
            Buscar
            <input
              type="search"
              value={search}
              placeholder="Título, arquivo, descrição ou versão"
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label>
            Categoria
            <select
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
            >
              <option value="all">Todas</option>
              {technicalDocumentCategories.map((category) => (
                <option key={category} value={category}>
                  {technicalDocumentCategoryLabels[category]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="technical-document-list">
          {loading && <p>Carregando documentos…</p>}
          {!loading && filteredDocuments.length === 0 && (
            <div className="empty-state">Nenhum documento corresponde aos filtros.</div>
          )}
          {filteredDocuments.map((document) => (
            <article className="technical-document-admin-card" key={document.id}>
              <div className="document-card-main">
                <span className="document-category-badge">
                  {technicalDocumentCategoryLabels[document.category]}
                </span>
                <strong>{document.title}</strong>
                <span>{document.fileName}</span>
                <small>
                  Versão {document.version} · {sizeLabel(document.size)} ·{' '}
                  {document.appliesToAllAreas
                    ? 'Todas as áreas'
                    : `${document.areaIds.length} área(s)`}
                </small>
              </div>
              <div className="document-admin-status">
                <span
                  className={`status-chip ${document.active ? 'status-completed' : 'status-cancelled'}`}
                >
                  {document.active ? 'Ativo' : 'Inativo'}
                </span>
                {document.status !== 'ready' && (
                  <span className="status-chip status-draft">{document.status}</span>
                )}
              </div>
              <div className="document-admin-actions">
                <button
                  className="button button-secondary compact-button"
                  onClick={() => startReplacement(document)}
                >
                  Nova versão
                </button>
                <button
                  className="button button-outline compact-button"
                  onClick={() => void toggleVersions(document.id)}
                >
                  {expandedVersions === document.id ? 'Ocultar histórico' : 'Histórico'}
                </button>
                <button
                  className="button button-outline compact-button"
                  onClick={() => void toggleActive(document)}
                >
                  {document.active ? 'Desativar' : 'Ativar'}
                </button>
              </div>
              {expandedVersions === document.id && (
                <div className="document-version-history">
                  {versions.length === 0 && <small>Carregando histórico…</small>}
                  {versions.map((version) => (
                    <div key={version.id}>
                      <strong>Versão {version.version}</strong>
                      <span>{version.fileName}</span>
                      <small>
                        {sizeLabel(version.size)} · {dateTimeLabel(version)}
                      </small>
                    </div>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getInspection } from '../services/inspectionService';
import { listTechnicalDocumentsForArea } from '../services/technicalDocumentService';
import type { Inspection } from '../types/inspection';
import {
  technicalDocumentCategories,
  technicalDocumentCategoryLabels,
  type TechnicalDocument,
} from '../types/technicalDocument';

function sizeLabel(size: number) {
  return size >= 1024 * 1024
    ? `${(size / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`
    : `${Math.max(1, Math.round(size / 1024))} KB`;
}

function issueDateLabel(value?: string) {
  if (!value) return 'Sem data de emissão';
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat('pt-BR').format(new Date(year, month - 1, day));
}

export function InspectionDocumentsPage() {
  const { inspectionId } = useParams();
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [documents, setDocuments] = useState<TechnicalDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');

  useEffect(() => {
    if (!inspectionId) return;
    let active = true;
    void getInspection(inspectionId)
      .then(async (nextInspection) => {
        if (!active) return;
        setInspection(nextInspection);
        const nextDocuments = await listTechnicalDocumentsForArea(
          nextInspection.projectId,
          nextInspection.areaId,
        );
        if (active) setDocuments(nextDocuments);
      })
      .catch(() => {
        if (active) setError('Não foi possível carregar os documentos desta inspeção.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [inspectionId]);

  const filteredDocuments = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR');
    return documents.filter((document) => {
      if (category !== 'all' && document.category !== category) return false;
      if (!term) return true;
      return [document.title, document.description, document.fileName].some((value) =>
        value?.toLocaleLowerCase('pt-BR').includes(term),
      );
    });
  }, [category, documents, search]);

  return (
    <section className="inspection-documents-page">
      <Link className="text-link back-link" to={`/inspections/${inspectionId}`}>
        ← Voltar para a inspeção
      </Link>
      <p className="eyebrow">Suporte ao inspetor</p>
      <div className="page-heading">
        <h1>Documentos de referência</h1>
        <span className="count-pill">{documents.length}</span>
      </div>
      {inspection && (
        <p className="page-intro">
          {inspection.areaCode} · {inspection.areaName}
        </p>
      )}
      {error && <div className="notice notice-error">{error}</div>}

      <div className="document-library-tools inspector-document-tools">
        <label>
          Buscar documento
          <input
            type="search"
            placeholder="Título, descrição ou arquivo"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label>
          Categoria
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="all">Todas as categorias</option>
            {technicalDocumentCategories.map((item) => (
              <option key={item} value={item}>
                {technicalDocumentCategoryLabels[item]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading && <p>Buscando referências da área…</p>}
      {!loading && filteredDocuments.length === 0 && (
        <div className="empty-state document-empty-state">
          <strong>Nenhum documento encontrado</strong>
          <span>Não há referências publicadas para esta área e filtro.</span>
        </div>
      )}
      <div className="inspector-document-grid">
        {filteredDocuments.map((document) => (
          <Link
            className="inspector-document-card"
            key={document.id}
            to={`/inspections/${inspectionId}/documents/${document.id}`}
          >
            <span className="pdf-file-mark" aria-hidden="true">
              PDF
            </span>
            <div>
              <span className="document-category-badge">
                {technicalDocumentCategoryLabels[document.category]}
              </span>
              <h2>{document.title}</h2>
              {document.description && <p>{document.description}</p>}
              <small>
                Versão {document.version} · {issueDateLabel(document.issueDate)} ·{' '}
                {sizeLabel(document.size)}
              </small>
            </div>
            <span className="document-open-label">Abrir →</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { useAuth } from '../features/auth/useAuth';
import {
  generateDashboardExport,
  listUsers,
  manageUserAccess,
  sendAccessEmail,
} from '../services/adminService';
import { listInspections } from '../services/inspectionService';
import { getStorageDownloadUrl } from '../services/photoService';
import type { Inspection } from '../types/inspection';
import type { UserProfile } from '../types/user';

const userSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome do usuário.'),
  email: z.email('Informe um e-mail válido.'),
  role: z.enum(['inspector', 'viewer']),
});

type UserForm = z.infer<typeof userSchema>;

const roleLabels = {
  admin: 'Administrador',
  inspector: 'Inspetor',
  viewer: 'Visualizador',
};

function dateLabel(inspection: Inspection) {
  const date = inspection.inspectionDate?.toDate?.();
  return date
    ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date)
    : 'Data não informada';
}

function downloadFile(url: string, fileName: string) {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

export function AdminPage() {
  const { profile } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [reportSearch, setReportSearch] = useState('');
  const [openingReport, setOpeningReport] = useState('');
  const [updatingUser, setUpdatingUser] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportSummary, setExportSummary] = useState('');
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<UserForm>({
    resolver: zodResolver(userSchema),
    defaultValues: { role: 'inspector' },
  });

  async function refreshData() {
    if (!profile) return;
    const [nextUsers, nextInspections] = await Promise.all([
      listUsers(),
      listInspections(profile.projectIds, true),
    ]);
    setUsers(nextUsers);
    setInspections(nextInspections);
  }

  useEffect(() => {
    if (!profile) return;
    let active = true;
    void Promise.all([listUsers(), listInspections(profile.projectIds, true)])
      .then(([nextUsers, nextInspections]) => {
        if (!active) return;
        setUsers(nextUsers);
        setInspections(nextInspections);
      })
      .catch(() => {
        if (active) setError('Não foi possível carregar os dados administrativos.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [profile]);

  const reports = useMemo(
    () => inspections.filter((inspection) => Boolean(inspection.reportStoragePath)),
    [inspections],
  );
  const filteredReports = useMemo(() => {
    const term = reportSearch.trim().toLocaleLowerCase('pt-BR');
    if (!term) return reports;
    return reports.filter((inspection) =>
      [
        inspection.code,
        inspection.areaCode,
        inspection.areaName,
        inspection.inspectorName,
        inspection.inspectorEmail,
      ].some((value) => value?.toLocaleLowerCase('pt-BR').includes(term)),
    );
  }, [reportSearch, reports]);

  async function handleUserSubmit(values: UserForm) {
    setError('');
    setSuccess('');
    try {
      const result = await manageUserAccess({
        ...values,
        email: values.email.trim().toLowerCase(),
        active: true,
        projectIds: ['p84'],
      });
      let message = `Acesso de ${values.email} configurado com sucesso.`;
      if (result.passwordSetupRequired) {
        try {
          await sendAccessEmail(values.email);
          message = `Usuário criado. O e-mail para definição de senha foi enviado para ${values.email}.`;
        } catch {
          message = `Usuário criado, mas o e-mail de definição de senha não foi enviado. Use “Reenviar acesso” na lista abaixo.`;
        }
      }
      setSuccess(message);
      reset({ name: '', email: '', role: 'inspector' });
      await refreshData();
    } catch {
      setError('Não foi possível configurar esse usuário. Verifique os dados e tente novamente.');
    }
  }

  async function toggleUser(user: UserProfile) {
    setUpdatingUser(user.uid);
    setError('');
    setSuccess('');
    try {
      await manageUserAccess({
        email: user.email,
        name: user.name,
        role: user.role,
        active: !user.active,
        projectIds: user.projectIds?.length ? user.projectIds : ['p84'],
      });
      setSuccess(`${user.name} foi ${user.active ? 'desativado' : 'reativado'}.`);
      await refreshData();
    } catch {
      setError('Não foi possível alterar o acesso desse usuário.');
    } finally {
      setUpdatingUser('');
    }
  }

  async function resendAccess(user: UserProfile) {
    setUpdatingUser(user.uid);
    setError('');
    setSuccess('');
    try {
      await sendAccessEmail(user.email);
      setSuccess(`E-mail para definição de senha enviado para ${user.email}.`);
    } catch {
      setError('Não foi possível enviar o e-mail de acesso agora.');
    } finally {
      setUpdatingUser('');
    }
  }

  async function openReport(inspection: Inspection) {
    if (!inspection.reportStoragePath) return;
    setOpeningReport(inspection.id);
    setError('');
    try {
      const url = await getStorageDownloadUrl(inspection.reportStoragePath);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      setError('O relatório não pôde ser aberto agora.');
    } finally {
      setOpeningReport('');
    }
  }

  async function exportDashboard() {
    setExporting(true);
    setError('');
    setSuccess('');
    setExportSummary('');
    try {
      const result = await generateDashboardExport();
      downloadFile(result.downloadUrl, result.fileName);
      setExportSummary(
        `${result.summary.inspections} inspeções, ${result.summary.rows} itens, ${result.summary.photos} fotografias e ${result.summary.reports} relatórios incluídos.`,
      );
    } catch {
      setError('Não foi possível gerar o pacote para dashboards. Tente novamente.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <section className="admin-page">
      <p className="eyebrow">Administração</p>
      <div className="page-heading">
        <h1>Central administrativa</h1>
        <span className="badge">Acesso restrito</span>
      </div>
      <p className="page-intro">
        Gerencie acessos, consulte os relatórios e prepare todos os dados para análise.
      </p>

      {error && <div className="notice notice-error">{error}</div>}
      {success && <div className="notice notice-success">{success}</div>}
      {loading && <p>Carregando central administrativa…</p>}

      {!loading && (
        <>
          <div className="admin-summary" aria-label="Resumo administrativo">
            <div>
              <strong>{users.filter((user) => user.active).length}</strong>
              <span>Usuários ativos</span>
            </div>
            <div>
              <strong>{inspections.length}</strong>
              <span>Inspeções</span>
            </div>
            <div>
              <strong>{reports.length}</strong>
              <span>Relatórios prontos</span>
            </div>
          </div>

          <section className="admin-section">
            <div className="admin-section-heading">
              <div>
                <p className="eyebrow">Controle de acesso</p>
                <h2>Adicionar usuário</h2>
              </div>
              <span className="admin-section-number">01</span>
            </div>
            <p className="section-description">
              O usuário receberá um e-mail para definir a senha. O acesso será restrito à obra P84.
            </p>
            <form className="admin-user-form" onSubmit={handleSubmit(handleUserSubmit)}>
              <label>
                Nome
                <input type="text" autoComplete="name" {...register('name')} />
                {errors.name && <small className="field-error">{errors.name.message}</small>}
              </label>
              <label>
                E-mail
                <input type="email" autoComplete="email" {...register('email')} />
                {errors.email && <small className="field-error">{errors.email.message}</small>}
              </label>
              <label>
                Perfil
                <select {...register('role')}>
                  <option value="inspector">Inspetor</option>
                  <option value="viewer">Visualizador</option>
                </select>
              </label>
              <button className="button button-primary compact-button" disabled={isSubmitting}>
                {isSubmitting ? 'Configurando…' : 'Adicionar e enviar acesso'}
              </button>
            </form>

            <div className="admin-user-list">
              {users.map((user) => (
                <article className="admin-user-row" key={user.uid}>
                  <div className="admin-user-identity">
                    <span className="avatar" aria-hidden="true">
                      {user.name.charAt(0).toUpperCase()}
                    </span>
                    <div>
                      <strong>{user.name}</strong>
                      <span>{user.email}</span>
                    </div>
                  </div>
                  <div className="admin-user-status">
                    <span className="badge">{roleLabels[user.role]}</span>
                    <span
                      className={`status-chip ${user.active ? 'status-completed' : 'status-cancelled'}`}
                    >
                      {user.active ? 'Ativo' : 'Inativo'}
                    </span>
                  </div>
                  <div className="admin-user-actions">
                    <button
                      className="button button-secondary compact-button"
                      disabled={updatingUser === user.uid || !user.active}
                      onClick={() => void resendAccess(user)}
                    >
                      Reenviar acesso
                    </button>
                    <button
                      className="button button-outline compact-button"
                      disabled={updatingUser === user.uid || user.uid === profile?.uid}
                      onClick={() => void toggleUser(user)}
                    >
                      {user.active ? 'Desativar' : 'Reativar'}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="admin-section">
            <div className="admin-section-heading">
              <div>
                <p className="eyebrow">Documentos oficiais</p>
                <h2>Biblioteca de relatórios</h2>
              </div>
              <span className="admin-section-number">02</span>
            </div>
            <div className="report-library-tools">
              <label>
                Buscar relatório
                <input
                  type="search"
                  placeholder="Código, área, inspetor ou e-mail"
                  value={reportSearch}
                  onChange={(event) => setReportSearch(event.target.value)}
                />
              </label>
              <span>{filteredReports.length} relatório(s)</span>
            </div>
            <div className="admin-report-list">
              {filteredReports.map((inspection) => (
                <article className="admin-report-row" key={inspection.id}>
                  <div>
                    <strong>{inspection.code}</strong>
                    <span>
                      {inspection.areaCode} · {inspection.areaName}
                    </span>
                  </div>
                  <div>
                    <span>Inspetor</span>
                    <strong>{inspection.inspectorName}</strong>
                  </div>
                  <time>{dateLabel(inspection)}</time>
                  <div className="admin-report-actions">
                    <Link
                      className="button button-secondary compact-button"
                      to={`/inspections/${inspection.id}`}
                    >
                      Ver inspeção
                    </Link>
                    <button
                      className="button report-button compact-button"
                      disabled={openingReport === inspection.id}
                      onClick={() => void openReport(inspection)}
                    >
                      {openingReport === inspection.id ? 'Abrindo…' : 'Abrir PDF'}
                    </button>
                  </div>
                </article>
              ))}
              {filteredReports.length === 0 && (
                <div className="empty-state">Nenhum relatório corresponde à busca.</div>
              )}
            </div>
          </section>

          <section className="admin-section export-section">
            <div className="admin-section-heading">
              <div>
                <p className="eyebrow">Excel e Power BI</p>
                <h2>Pacote para dashboards</h2>
              </div>
              <span className="admin-section-number">03</span>
            </div>
            <p className="section-description">
              Gera um ZIP com um CSV único de todas as inspeções e itens, manifesto das imagens,
              pastas de fotografias identificadas pelo item do checklist e todos os PDFs
              disponíveis.
            </p>
            <div className="export-contents">
              <span>dados/inspecoes_itens.csv</span>
              <span>dados/manifesto_imagens.csv</span>
              <span>imagens/INSPEÇÃO/ITEM/</span>
              <span>relatorios/</span>
            </div>
            <button
              className="button button-primary compact-button export-button"
              disabled={exporting}
              onClick={() => void exportDashboard()}
            >
              {exporting ? 'Preparando pacote…' : 'Gerar pacote completo (.zip)'}
            </button>
            {exportSummary && <div className="notice notice-success">{exportSummary}</div>}
          </section>
        </>
      )}
    </section>
  );
}

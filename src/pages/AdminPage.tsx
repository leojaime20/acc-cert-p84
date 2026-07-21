import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { useAuth } from '../features/auth/useAuth';
import {
  generateDashboardExport,
  deleteInspection as deleteInspectionRecord,
  listUsers,
  manageUserAccess,
  sendAccessEmail,
} from '../services/adminService';
import { listInspections } from '../services/inspectionService';
import { getStorageDownloadUrl } from '../services/photoService';
import type { Inspection } from '../types/inspection';
import type { UserProfile } from '../types/user';

const userSchema = z.object({
  name: z.string().trim().min(2, 'Enter the user name.'),
  email: z.email('Enter a valid email address.'),
  role: z.enum(['inspector', 'viewer']),
});

type UserForm = z.infer<typeof userSchema>;

const roleLabels = {
  admin: 'Administrator',
  inspector: 'Inspector',
  viewer: 'Viewer',
};

const inspectionStatusLabels = {
  draft: 'Draft',
  completed: 'Completed',
  reopened: 'Reopened',
  cancelled: 'Cancelled',
};

function dateLabel(inspection: Inspection) {
  const date = inspection.inspectionDate?.toDate?.();
  return date
    ? new Intl.DateTimeFormat('en', { dateStyle: 'short', timeStyle: 'short' }).format(date)
    : 'Date unavailable';
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
  const [inspectionSearch, setInspectionSearch] = useState('');
  const [openingReport, setOpeningReport] = useState('');
  const [updatingUser, setUpdatingUser] = useState('');
  const [exporting, setExporting] = useState(false);
  const [deletingInspection, setDeletingInspection] = useState('');
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
        if (active) setError('Unable to load the administration data.');
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
    const term = reportSearch.trim().toLocaleLowerCase('en');
    if (!term) return reports;
    return reports.filter((inspection) =>
      [
        inspection.code,
        inspection.areaCode,
        inspection.areaName,
        inspection.inspectorName,
        inspection.inspectorEmail,
      ].some((value) => value?.toLocaleLowerCase('en').includes(term)),
    );
  }, [reportSearch, reports]);
  const filteredInspections = useMemo(() => {
    const term = inspectionSearch.trim().toLocaleLowerCase('en');
    if (!term) return inspections;
    return inspections.filter((inspection) =>
      [
        inspection.code,
        inspection.areaCode,
        inspection.areaName,
        inspection.inspectorName,
        inspection.inspectorEmail,
        inspection.status,
      ].some((value) => value?.toLocaleLowerCase('en').includes(term)),
    );
  }, [inspectionSearch, inspections]);

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
      let message = `Access for ${values.email} was configured successfully.`;
      if (result.passwordSetupRequired) {
        try {
          await sendAccessEmail(values.email);
          message = `User created. A password setup email was sent to ${values.email}.`;
        } catch {
          message = `User created, but the password setup email could not be sent. Use “Resend access” below.`;
        }
      }
      setSuccess(message);
      reset({ name: '', email: '', role: 'inspector' });
      await refreshData();
    } catch {
      setError('Unable to configure this user. Check the details and try again.');
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
      setSuccess(`${user.name} was ${user.active ? 'deactivated' : 'reactivated'}.`);
      await refreshData();
    } catch {
      setError('Unable to change this user’s access.');
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
      setSuccess(`A password setup email was sent to ${user.email}.`);
    } catch {
      setError('Unable to send the access email right now.');
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
      setError('The report could not be opened right now.');
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
        `${result.summary.inspections} inspections, ${result.summary.rows} items, ${result.summary.photos} photos and ${result.summary.reports} reports included.`,
      );
    } catch {
      setError('Unable to generate the dashboard package. Try again.');
    } finally {
      setExporting(false);
    }
  }

  async function removeInspection(inspection: Inspection) {
    const confirmed = window.confirm(
      `Delete inspection ${inspection.code}? This permanently removes its checklist, photos and report.`,
    );
    if (!confirmed) return;
    setDeletingInspection(inspection.id);
    setError('');
    setSuccess('');
    try {
      await deleteInspectionRecord(inspection.id);
      setSuccess(`Inspection ${inspection.code} was deleted.`);
      await refreshData();
    } catch {
      setError('Unable to delete this inspection. Try again.');
    } finally {
      setDeletingInspection('');
    }
  }

  return (
    <section className="admin-page">
      <p className="eyebrow">Administration</p>
      <div className="page-heading">
        <h1>Administration center</h1>
        <span className="badge">Restricted access</span>
      </div>
      <p className="page-intro">Manage access, review inspections and prepare data for analysis.</p>

      <Link className="admin-module-link" to="/admin/documents">
        <span className="pdf-file-mark" aria-hidden="true">
          PDF
        </span>
        <span>
          <strong>Technical documents</strong>
          <small>Publish references and manage versions by area</small>
        </span>
        <span aria-hidden="true">→</span>
      </Link>

      {error && <div className="notice notice-error">{error}</div>}
      {success && <div className="notice notice-success">{success}</div>}
      {loading && <p>Loading the administration center…</p>}

      {!loading && (
        <>
          <div className="admin-summary" aria-label="Administration summary">
            <div>
              <strong>{users.filter((user) => user.active).length}</strong>
              <span>Active users</span>
            </div>
            <div>
              <strong>{inspections.length}</strong>
              <span>Inspections</span>
            </div>
            <div>
              <strong>{reports.length}</strong>
              <span>Ready reports</span>
            </div>
          </div>

          <section className="admin-section">
            <div className="admin-section-heading">
              <div>
                <p className="eyebrow">Access control</p>
                <h2>Add user</h2>
              </div>
              <span className="admin-section-number">01</span>
            </div>
            <p className="section-description">
              The user will receive an email to set a password. Access is restricted to project P84.
            </p>
            <form className="admin-user-form" onSubmit={handleSubmit(handleUserSubmit)}>
              <label>
                Name
                <input type="text" autoComplete="name" {...register('name')} />
                {errors.name && <small className="field-error">{errors.name.message}</small>}
              </label>
              <label>
                E-mail
                <input type="email" autoComplete="email" {...register('email')} />
                {errors.email && <small className="field-error">{errors.email.message}</small>}
              </label>
              <label>
                Role
                <select {...register('role')}>
                  <option value="inspector">Inspector</option>
                  <option value="viewer">Viewer</option>
                </select>
              </label>
              <button className="button button-primary compact-button" disabled={isSubmitting}>
                {isSubmitting ? 'Configuring…' : 'Add and send access'}
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
                      {user.active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <div className="admin-user-actions">
                    <button
                      className="button button-secondary compact-button"
                      disabled={updatingUser === user.uid || !user.active}
                      onClick={() => void resendAccess(user)}
                    >
                      Resend access
                    </button>
                    <button
                      className="button button-outline compact-button"
                      disabled={updatingUser === user.uid || user.uid === profile?.uid}
                      onClick={() => void toggleUser(user)}
                    >
                      {user.active ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="admin-section">
            <div className="admin-section-heading">
              <div>
                <p className="eyebrow">Official documents</p>
                <h2>Report library</h2>
              </div>
              <span className="admin-section-number">02</span>
            </div>
            <div className="report-library-tools">
              <label>
                Search reports
                <input
                  type="search"
                  placeholder="Code, area, inspector or email"
                  value={reportSearch}
                  onChange={(event) => setReportSearch(event.target.value)}
                />
              </label>
              <span>{filteredReports.length} report(s)</span>
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
                    <span>Inspector</span>
                    <strong>{inspection.inspectorName}</strong>
                  </div>
                  <time>{dateLabel(inspection)}</time>
                  <div className="admin-report-actions">
                    <Link
                      className="button button-secondary compact-button"
                      to={`/inspections/${inspection.id}`}
                    >
                      View inspection
                    </Link>
                    <button
                      className="button report-button compact-button"
                      disabled={openingReport === inspection.id}
                      onClick={() => void openReport(inspection)}
                    >
                      {openingReport === inspection.id ? 'Opening…' : 'Open PDF'}
                    </button>
                  </div>
                </article>
              ))}
              {filteredReports.length === 0 && (
                <div className="empty-state">No reports match your search.</div>
              )}
            </div>
          </section>

          <section className="admin-section export-section">
            <div className="admin-section-heading">
              <div>
                <p className="eyebrow">Excel and Power BI</p>
                <h2>Dashboard package</h2>
              </div>
              <span className="admin-section-number">03</span>
            </div>
            <p className="section-description">
              Generates a ZIP containing a single CSV for all inspections and items, an image
              manifest, photo folders identified by checklist item and all available PDFs.
            </p>
            <div className="export-contents">
              <span>data/inspection_items.csv</span>
              <span>data/image_manifest.csv</span>
              <span>images/INSPECTION/ITEM/</span>
              <span>reports/</span>
            </div>
            <button
              className="button button-primary compact-button export-button"
              disabled={exporting}
              onClick={() => void exportDashboard()}
            >
              {exporting ? 'Preparing package…' : 'Generate full package (.zip)'}
            </button>
            {exportSummary && <div className="notice notice-success">{exportSummary}</div>}
          </section>

          <section className="admin-section">
            <div className="admin-section-heading">
              <div>
                <p className="eyebrow">Inspection management</p>
                <h2>Delete inspections</h2>
              </div>
              <span className="admin-section-number">04</span>
            </div>
            <p className="section-description">
              Permanently delete draft or completed inspections, including their checklist, photos
              and generated report.
            </p>
            <div className="report-library-tools">
              <label>
                Search inspections
                <input
                  type="search"
                  placeholder="Code, area, inspector or status"
                  value={inspectionSearch}
                  onChange={(event) => setInspectionSearch(event.target.value)}
                />
              </label>
              <span>{filteredInspections.length} inspection(s)</span>
            </div>
            <div className="admin-report-list">
              {filteredInspections.map((inspection) => (
                <article className="admin-report-row" key={inspection.id}>
                  <div>
                    <strong>{inspection.code}</strong>
                    <span>
                      {inspection.areaCode} · {inspection.areaName}
                    </span>
                  </div>
                  <div>
                    <span>Inspector</span>
                    <strong>{inspection.inspectorName}</strong>
                  </div>
                  <time>{dateLabel(inspection)}</time>
                  <div className="admin-report-actions">
                    <span className={`status-chip status-${inspection.status}`}>
                      {inspectionStatusLabels[inspection.status]}
                    </span>
                    <Link
                      className="button button-secondary compact-button"
                      to={`/inspections/${inspection.id}`}
                    >
                      View
                    </Link>
                    <button
                      className="button button-outline compact-button"
                      disabled={deletingInspection === inspection.id}
                      onClick={() => void removeInspection(inspection)}
                    >
                      {deletingInspection === inspection.id ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </article>
              ))}
              {filteredInspections.length === 0 && (
                <div className="empty-state">No inspections match your search.</div>
              )}
            </div>
          </section>
        </>
      )}
    </section>
  );
}

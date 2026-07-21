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
    ? `${(size / (1024 * 1024)).toLocaleString('en', { maximumFractionDigits: 1 })} MB`
    : `${Math.max(1, Math.round(size / 1024))} KB`;
}

function issueDateLabel(value?: string) {
  if (!value) return 'No issue date';
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat('en').format(new Date(year, month - 1, day));
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
        if (active) setError('Unable to load documents for this inspection.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [inspectionId]);

  const filteredDocuments = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('en');
    return documents.filter((document) => {
      if (category !== 'all' && document.category !== category) return false;
      if (!term) return true;
      return [document.title, document.description, document.fileName].some((value) =>
        value?.toLocaleLowerCase('en').includes(term),
      );
    });
  }, [category, documents, search]);

  return (
    <section className="inspection-documents-page">
      <Link className="text-link back-link" to={`/inspections/${inspectionId}`}>
        ← Back to inspection
      </Link>
      <p className="eyebrow">Inspector support</p>
      <div className="page-heading">
        <h1>Reference documents</h1>
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
          Search documents
          <input
            type="search"
            placeholder="Title, description or file"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label>
          Category
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="all">All categories</option>
            {technicalDocumentCategories.map((item) => (
              <option key={item} value={item}>
                {technicalDocumentCategoryLabels[item]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading && <p>Finding area references…</p>}
      {!loading && filteredDocuments.length === 0 && (
        <div className="empty-state document-empty-state">
          <strong>No documents found</strong>
          <span>There are no published references for this area and filter.</span>
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
                Version {document.version} · {issueDateLabel(document.issueDate)} ·{' '}
                {sizeLabel(document.size)}
              </small>
            </div>
            <span className="document-open-label">Open →</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

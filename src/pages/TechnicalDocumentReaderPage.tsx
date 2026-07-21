import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PdfViewer } from '../components/documents/PdfViewer';
import { getInspection } from '../services/inspectionService';
import {
  getTechnicalDocument,
  getTechnicalDocumentBytes,
  getTechnicalDocumentUrl,
} from '../services/technicalDocumentService';
import type { Inspection } from '../types/inspection';
import {
  technicalDocumentCategoryLabels,
  type TechnicalDocument,
} from '../types/technicalDocument';

export function TechnicalDocumentReaderPage() {
  const { inspectionId, documentId } = useParams();
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [document, setDocument] = useState<TechnicalDocument | null>(null);
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadDocumentBytes = useCallback(() => {
    if (!document) return Promise.reject(new Error('Documento não carregado.'));
    return getTechnicalDocumentBytes(document);
  }, [document]);

  useEffect(() => {
    if (!inspectionId || !documentId) return;
    let active = true;
    void Promise.all([getInspection(inspectionId), getTechnicalDocument(documentId)])
      .then(async ([nextInspection, nextDocument]) => {
        const appliesToInspection =
          nextDocument.projectId === nextInspection.projectId &&
          (nextDocument.appliesToAllAreas || nextDocument.areaIds.includes(nextInspection.areaId));
        if (!appliesToInspection || !nextDocument.active || nextDocument.status !== 'ready') {
          throw new Error('Documento indisponível para esta área.');
        }
        const nextUrl = await getTechnicalDocumentUrl(nextDocument);
        if (!active) return;
        setInspection(nextInspection);
        setDocument(nextDocument);
        setUrl(nextUrl);
      })
      .catch((loadError) => {
        if (active) {
          setError(
            loadError instanceof Error && loadError.message.includes('indisponível')
              ? loadError.message
              : 'Não foi possível abrir este documento agora.',
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [documentId, inspectionId]);

  return (
    <section className="technical-document-reader-page">
      <Link className="text-link back-link" to={`/inspections/${inspectionId}/documents`}>
        ← Voltar aos documentos
      </Link>
      <p className="eyebrow">Documento de referência</p>
      <div className="reader-heading">
        <div>
          <h1>{document?.title || (loading ? 'Carregando documento…' : 'Documento')}</h1>
          {document && (
            <p>
              {technicalDocumentCategoryLabels[document.category]} · Versão {document.version}
              {inspection ? ` · ${inspection.areaCode}` : ''}
            </p>
          )}
        </div>
      </div>
      {error && (
        <div className="notice notice-error">
          {error}{' '}
          <button className="inline-retry" onClick={() => window.location.reload()}>
            Tentar novamente
          </button>
        </div>
      )}
      {url && document && (
        <PdfViewer
          url={url}
          title={document.title}
          allowDownload={document.allowDownload}
          loadBytes={loadDocumentBytes}
        />
      )}
    </section>
  );
}

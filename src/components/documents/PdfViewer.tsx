import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

interface PdfViewerProps {
  url: string;
  title: string;
  allowDownload: boolean;
  loadBytes?: () => Promise<ArrayBuffer>;
}

function readerErrorMessage(error: unknown) {
  const name = error instanceof Error ? error.name : '';
  if (name === 'PasswordException') {
    return 'This PDF is password protected. Open it in your device reader.';
  }
  if (name === 'InvalidPDFException') {
    return 'The PDF file appears to be invalid or corrupted.';
  }
  if (name === 'MissingPDFException' || name === 'UnexpectedResponseException') {
    return 'The file could not be downloaded from storage.';
  }
  return 'The reader could not load this PDF.';
}

export function PdfViewer({ url, title, allowDownload, loadBytes }: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<RenderTask | undefined>(undefined);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [containerWidth, setContainerWidth] = useState(0);
  const [loading, setLoading] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const updateWidth = () => setContainerWidth(container.clientWidth);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let active = true;
    let loadedPdf: PDFDocumentProxy | undefined;

    void import('pdfjs-dist/legacy/build/pdf.mjs')
      .then(async (pdfjs) => {
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        try {
          loadedPdf = await pdfjs.getDocument({ url }).promise;
        } catch (urlError) {
          if (!loadBytes) throw urlError;
          const bytes = await loadBytes();
          loadedPdf = await pdfjs.getDocument({
            data: new Uint8Array(bytes),
          }).promise;
        }
        if (active) setPdf(loadedPdf);
      })
      .catch((loadError: unknown) => {
        if (active) setError(readerErrorMessage(loadError));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      renderTaskRef.current?.cancel();
      void loadedPdf?.destroy();
    };
  }, [loadBytes, url]);

  useEffect(() => {
    if (!pdf || !canvasRef.current || !containerWidth) return;
    let active = true;

    void pdf
      .getPage(pageNumber)
      .then(async (page) => {
        if (!active || !canvasRef.current) return;
        setRendering(true);
        setError('');
        const baseViewport = page.getViewport({ scale: 1 });
        const fitScale = Math.min(1.75, Math.max(0.25, (containerWidth - 32) / baseViewport.width));
        const cssScale = fitScale * zoom;
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({ scale: cssScale * pixelRatio });
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas unavailable.');

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width / pixelRatio)}px`;
        canvas.style.height = `${Math.floor(viewport.height / pixelRatio)}px`;
        renderTaskRef.current?.cancel();
        renderTaskRef.current = page.render({ canvas, canvasContext: context, viewport });
        await renderTaskRef.current.promise;
      })
      .catch((renderError: unknown) => {
        if (
          active &&
          !(renderError instanceof Error && renderError.name === 'RenderingCancelledException')
        ) {
          setError('Unable to display this page.');
        }
      })
      .finally(() => {
        if (active) setRendering(false);
      });

    return () => {
      active = false;
      renderTaskRef.current?.cancel();
    };
  }, [containerWidth, pageNumber, pdf, zoom]);

  async function toggleFullscreen() {
    const container = containerRef.current;
    if (!container) return;
    if (document.fullscreenElement) await document.exitFullscreen();
    else await container.requestFullscreen();
  }

  return (
    <div className="pdf-viewer" ref={containerRef}>
      <div className="pdf-toolbar" aria-label="PDF reader controls">
        <div className="pdf-page-controls">
          <button
            className="button button-outline compact-button"
            disabled={!pdf || pageNumber <= 1}
            onClick={() => setPageNumber((current) => Math.max(1, current - 1))}
            aria-label="Previous page"
          >
            ←
          </button>
          <span>
            {pageNumber} / {pdf?.numPages || '–'}
          </span>
          <button
            className="button button-outline compact-button"
            disabled={!pdf || pageNumber >= pdf.numPages}
            onClick={() => setPageNumber((current) => Math.min(pdf?.numPages || 1, current + 1))}
            aria-label="Next page"
          >
            →
          </button>
        </div>
        <div className="pdf-zoom-controls">
          <button
            className="button button-outline compact-button"
            disabled={!pdf || zoom <= 0.6}
            onClick={() => setZoom((current) => Math.max(0.6, current - 0.2))}
            aria-label="Zoom out"
          >
            −
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button
            className="button button-outline compact-button"
            disabled={!pdf || zoom >= 2.4}
            onClick={() => setZoom((current) => Math.min(2.4, current + 0.2))}
            aria-label="Zoom in"
          >
            +
          </button>
          <button
            className="button button-outline compact-button pdf-fullscreen-button"
            onClick={() => void toggleFullscreen()}
          >
            Full screen
          </button>
          {allowDownload && (
            <a
              className="button button-secondary compact-button"
              href={url}
              download
              target="_blank"
              rel="noreferrer"
            >
              Download
            </a>
          )}
        </div>
      </div>

      {loading && <div className="pdf-loading">Preparing reader…</div>}
      {error && (
        <div className="pdf-fallback notice notice-error">
          <p>{error}</p>
          <a
            className="button button-outline compact-button"
            href={url}
            target="_blank"
            rel="noreferrer"
          >
            Open in device reader
          </a>
        </div>
      )}
      <div className={`pdf-canvas-stage ${rendering ? 'is-rendering' : ''}`}>
        <canvas ref={canvasRef} aria-label={`Page ${pageNumber} of ${title}`} />
      </div>
    </div>
  );
}

import { describe, expect, it } from 'vitest';
import {
  MAX_TECHNICAL_DOCUMENT_SIZE,
  TechnicalDocumentError,
  validateTechnicalDocumentFile,
} from './technicalDocumentService';

function pdfFile(content = '%PDF-1.7\n%%EOF', options?: { name?: string; type?: string }) {
  return new File([content], options?.name || 'manual.pdf', {
    type: options?.type ?? 'application/pdf',
  });
}

describe('validateTechnicalDocumentFile', () => {
  it('accepts a PDF with extension, MIME and signature', async () => {
    await expect(validateTechnicalDocumentFile(pdfFile())).resolves.toBeUndefined();
  });

  it('rejects a file with a forged PDF extension', async () => {
    await expect(validateTechnicalDocumentFile(pdfFile('not a pdf'))).rejects.toMatchObject({
      code: 'signature',
    } satisfies Partial<TechnicalDocumentError>);
  });

  it('rejects an incompatible MIME type', async () => {
    await expect(
      validateTechnicalDocumentFile(pdfFile(undefined, { type: 'text/plain' })),
    ).rejects.toMatchObject({ code: 'mime-type' } satisfies Partial<TechnicalDocumentError>);
  });

  it('rejects PDFs larger than 50 MB', async () => {
    const oversized = new File([new Uint8Array(MAX_TECHNICAL_DOCUMENT_SIZE + 1)], 'large.pdf', {
      type: 'application/pdf',
    });
    await expect(validateTechnicalDocumentFile(oversized)).rejects.toMatchObject({
      code: 'too-large',
    } satisfies Partial<TechnicalDocumentError>);
  });
});

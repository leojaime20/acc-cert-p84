import { describe, expect, it } from 'vitest';
import {
  buildPhotoArchivePath,
  csvText,
  sanitizeArchiveSegment,
  timestampToIso,
} from './exportHelpers.js';

describe('export helpers', () => {
  it('normaliza nomes de pastas sem perder códigos técnicos', () => {
    expect(sanitizeArchiveSegment('MCCR-A-03 / Área 01')).toBe('MCCR-A-03-Area-01');
  });

  it('relaciona o arquivo da fotografia ao item do checklist', () => {
    expect(
      buildPhotoArchivePath({
        inspectionCode: 'P84-A100-20260720',
        itemCode: 'MCCR-A-03-02',
        photoId: 'foto 1',
        order: 2,
        storagePath: 'inspections/abc/items/item/foto.jpg',
      }),
    ).toBe('imagens/P84-A100-20260720/MCCR-A-03-02/MCCR-A-03-02_002_foto-1.jpg');
  });

  it('gera CSV UTF-8 compatível com textos, vírgulas e aspas', () => {
    const csv = csvText(
      ['codigo', 'comentario'],
      [{ codigo: 'A100', comentario: 'Texto, com "aspas"' }],
    );
    expect(csv).toBe('\ufeffcodigo,comentario\r\nA100,"Texto, com ""aspas"""\r\n');
  });

  it('preserva datas como ISO para ferramentas de dashboard', () => {
    expect(timestampToIso(new Date('2026-07-20T15:54:48.416Z'))).toBe('2026-07-20T15:54:48.416Z');
  });
});

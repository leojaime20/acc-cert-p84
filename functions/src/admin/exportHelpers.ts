export type ExportCell = string | number | boolean | null | undefined;

export function sanitizeArchiveSegment(value: unknown, fallback = 'sem-identificacao') {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
  return normalized || fallback;
}

export function csvText(headers: string[], rows: Record<string, ExportCell>[]) {
  const escape = (value: ExportCell) => {
    const serialized = value === null || value === undefined ? '' : String(value);
    return /[",\r\n]/.test(serialized) ? `"${serialized.replace(/"/g, '""')}"` : serialized;
  };

  return `\ufeff${[headers, ...rows.map((row) => headers.map((header) => row[header]))]
    .map((row) => row.map(escape).join(','))
    .join('\r\n')}\r\n`;
}

export function timestampToIso(value: unknown) {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && 'toDate' in value) {
    const toDate = (value as { toDate?: unknown }).toDate;
    if (typeof toDate === 'function') return (toDate.call(value) as Date).toISOString();
  }
  if (typeof value === 'object' && '_seconds' in value) {
    return new Date(Number((value as { _seconds: unknown })._seconds) * 1000).toISOString();
  }
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

export function buildPhotoArchivePath(input: {
  inspectionCode: string;
  itemCode?: string | null;
  photoId: string;
  order: number;
  storagePath: string;
}) {
  const inspection = sanitizeArchiveSegment(input.inspectionCode, 'inspecao');
  const item = sanitizeArchiveSegment(input.itemCode || 'GERAIS', 'GERAIS');
  const extensionMatch = input.storagePath.match(/\.[a-zA-Z0-9]{2,5}$/);
  const extension = extensionMatch?.[0]?.toLowerCase() || '.jpg';
  const sequence = String(input.order).padStart(3, '0');
  const photo = sanitizeArchiveSegment(input.photoId, 'foto').slice(0, 24);
  return `imagens/${inspection}/${item}/${item}_${sequence}_${photo}${extension}`;
}

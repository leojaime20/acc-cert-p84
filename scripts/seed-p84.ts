import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { p84AreasTsv } from './data/p84-areas';
import { p84ChecklistTsv } from './data/p84-checklists';

interface AreaSeed {
  order: number;
  code: string;
  sourceCode?: string;
  checklistCode: string;
  location: string;
  name: string;
}

interface ChecklistSeed {
  code: string;
  name: string;
  items: Array<{ itemNumber: number; description: string; order: number }>;
}

function normalizeKey(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');
}

function parseAreas(): { areas: AreaSeed[]; safetyPlanReferences: string[] } {
  const records: string[] = [];
  for (const rawLine of p84AreasTsv.trim().split(/\r?\n/).slice(1)) {
    const line = rawLine.trimEnd();
    if (/^\d+\t/.test(line)) records.push(line);
    else if (records.length) records[records.length - 1] += ` ${line.trim()}`;
  }

  let omb04Count = 0;
  const areas: AreaSeed[] = [];
  const safetyPlanReferences: string[] = [];

  for (const record of records) {
    const [orderValue, sourceCodeValue, checklistValue, locationValue, ...descriptionParts] =
      record.split('\t');
    const order = Number(orderValue);
    const sourceCode = sourceCodeValue?.trim() || '';
    const checklistCode = checklistValue?.trim() || '';
    const location = locationValue?.trim() || '';
    const name = descriptionParts.join(' ').replace(/^"|"$/g, '').trim();

    if (!checklistCode) {
      safetyPlanReferences.push(`${sourceCode}: ${location} — ${name}`);
      continue;
    }

    let code = sourceCode;
    if (sourceCode === 'OMB04') {
      omb04Count += 1;
      code = `OMB04-${omb04Count === 1 ? 'A' : 'B'}`;
    }

    areas.push({
      order,
      code,
      ...(code !== sourceCode ? { sourceCode } : {}),
      checklistCode,
      location,
      name,
    });
  }

  return { areas, safetyPlanReferences };
}

function parseChecklists(): ChecklistSeed[] {
  const byCode = new Map<string, ChecklistSeed>();
  for (const line of p84ChecklistTsv.trim().split(/\r?\n/).slice(1)) {
    const [labelValue, itemNumberValue, ...descriptionParts] = line.split('\t');
    const label = labelValue?.trim() || '';
    const match = label.match(/^(MCCR-A-\d{2})\s*[–-]\s*(.+)$/);
    if (!match?.[1] || !match[2]) throw new Error(`Checklist inválido: ${label}`);
    const code = match[1];
    const itemNumber = Number(itemNumberValue);
    const checklist = byCode.get(code) || { code, name: match[2].trim(), items: [] };
    checklist.items.push({
      itemNumber,
      description: descriptionParts.join(' ').trim(),
      order: checklist.items.length + 1,
    });
    byCode.set(code, checklist);
  }
  return [...byCode.values()];
}

async function main() {
  const { areas, safetyPlanReferences } = parseAreas();
  const checklists = parseChecklists();
  const checklistItemCount = checklists.reduce(
    (total, checklist) => total + checklist.items.length,
    0,
  );
  const areaCodes = new Set(areas.map((area) => area.code));
  if (areas.length !== 374 || areaCodes.size !== 374) {
    throw new Error(`Esperadas 374 áreas únicas; recebidas ${areas.length}/${areaCodes.size}.`);
  }
  if (checklists.length !== 5 || checklistItemCount !== 108) {
    throw new Error(
      `Esperados 5 checklists e 108 itens; recebidos ${checklists.length}/${checklistItemCount}.`,
    );
  }
  if (safetyPlanReferences.length !== 6) {
    throw new Error(
      `Esperadas 6 referências Safety Plan; recebidas ${safetyPlanReferences.length}.`,
    );
  }

  if (process.argv.includes('--dry-run')) {
    console.log(
      `Dados válidos: ${areas.length} áreas, ${checklists.length} checklists, ${checklistItemCount} itens e ${safetyPlanReferences.length} referências Safety Plan.`,
    );
    return;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT;
  if (!projectId) throw new Error('Defina FIREBASE_PROJECT_ID antes de executar a carga.');

  if (getApps().length === 0) {
    initializeApp({ credential: applicationDefault(), projectId });
  }

  const db = getFirestore();
  const writer = db.bulkWriter();
  const now = FieldValue.serverTimestamp();
  const projectRef = db.doc('projects/p84');

  writer.set(
    projectRef,
    {
      code: 'P84',
      name: 'P84',
      description: 'Projeto inicial de certificação ACC',
      active: true,
      source: 'initial-seed',
      createdAt: now,
      updatedAt: now,
    },
    { merge: true },
  );

  for (const checklist of checklists) {
    const templateRef = db.doc(`checklistTemplates/${checklist.code}`);
    writer.set(
      templateRef,
      {
        code: checklist.code,
        projectId: 'p84',
        name: checklist.name,
        version: 1,
        active: true,
        itemCount: checklist.items.length,
        source: 'initial-seed',
        createdBy: 'system',
        createdAt: now,
        updatedAt: now,
      },
      { merge: true },
    );
    for (const item of checklist.items) {
      const itemId = `item-${String(item.itemNumber).padStart(2, '0')}`;
      writer.set(
        templateRef.collection('items').doc(itemId),
        {
          itemNumber: item.itemNumber,
          code: `${checklist.code}-${String(item.itemNumber).padStart(2, '0')}`,
          description: item.description,
          verificationInstruction: item.description,
          order: item.order,
          required: true,
          photoRequired: false,
          active: true,
        },
        { merge: true },
      );
    }
  }

  for (const area of areas) {
    writer.set(
      projectRef.collection('areas').doc(normalizeKey(area.code)),
      {
        projectId: 'p84',
        code: area.code,
        ...(area.sourceCode ? { sourceCode: area.sourceCode } : {}),
        name: area.name,
        description: area.name,
        location: area.location,
        locationKey: normalizeKey(area.location),
        checklistTemplateId: area.checklistCode,
        active: true,
        order: area.order,
        source: 'initial-seed',
        createdAt: now,
        updatedAt: now,
      },
      { merge: true },
    );
  }

  writer.set(
    db.doc('seedMetadata/p84-initial'),
    {
      projectId: 'p84',
      areaCount: areas.length,
      checklistCount: checklists.length,
      checklistItemCount,
      excludedSafetyPlanReferences: safetyPlanReferences,
      updatedAt: now,
    },
    { merge: true },
  );

  await writer.close();
  console.log(
    `Carga concluída: ${areas.length} áreas, ${checklists.length} checklists e ${checklistItemCount} itens.`,
  );
  if (safetyPlanReferences.length) {
    console.log(
      `${safetyPlanReferences.length} referências de Safety Plan foram preservadas nos metadados.`,
    );
  }
}

await main();

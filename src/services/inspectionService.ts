import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../lib/firebase/firestore';
import type { ChecklistTemplate, ChecklistTemplateItem } from '../types/checklist';
import type { Inspection, InspectionItem } from '../types/inspection';
import type { Area } from '../types/project';
import type { UserProfile } from '../types/user';

function requireDb() {
  if (!db) throw new Error('Firebase não configurado.');
  return db;
}

function inspectionCode(area: Area) {
  const date = new Date();
  const day = [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((value) => String(value).padStart(2, '0'))
    .join('');
  const time = [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((value) => String(value).padStart(2, '0'))
    .join('');
  return `${area.projectId.toUpperCase()}-${area.code}-${day}-${time}`;
}

export async function createInspection(area: Area, inspector: UserProfile) {
  const firestore = requireDb();
  const templateRef = doc(firestore, 'checklistTemplates', area.checklistTemplateId);
  const [templateSnapshot, itemSnapshots] = await Promise.all([
    getDoc(templateRef),
    getDocs(query(collection(templateRef, 'items'), orderBy('order'))),
  ]);

  if (!templateSnapshot.exists()) throw new Error('Checklist da área não encontrado.');
  if (itemSnapshots.empty) throw new Error('O checklist não possui itens ativos.');

  const template = { id: templateSnapshot.id, ...templateSnapshot.data() } as ChecklistTemplate;
  const activeItems = itemSnapshots.docs
    .map((item) => ({ id: item.id, ...item.data() }) as ChecklistTemplateItem)
    .filter((item) => item.active);
  if (activeItems.length === 0) throw new Error('O checklist não possui itens ativos.');

  const inspectionRef = doc(collection(firestore, 'inspections'));
  const batch = writeBatch(firestore);
  batch.set(inspectionRef, {
    code: inspectionCode(area),
    projectId: area.projectId,
    areaId: area.id,
    areaCode: area.code,
    areaName: area.name,
    areaLocation: area.location,
    checklistTemplateId: template.id,
    checklistTemplateCode: template.code,
    checklistTemplateVersion: template.version,
    inspectorId: inspector.uid,
    inspectorName: inspector.name,
    inspectorEmail: inspector.email,
    status: 'draft',
    inspectionDate: serverTimestamp(),
    summary: {
      total: activeItems.length,
      notStarted: activeItems.length,
      approved: 0,
      partiallyApproved: 0,
      rejected: 0,
      notApplicable: 0,
    },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  for (const item of activeItems) {
    batch.set(doc(inspectionRef, 'items', item.id), {
      templateItemId: item.id,
      itemNumber: item.itemNumber,
      code: `${template.code}-${String(item.itemNumber).padStart(2, '0')}`,
      description: item.description,
      order: item.order,
      required: item.required,
      photoRequired: item.photoRequired,
      status: 'not_started',
      comment: '',
      recommendation: '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  await batch.commit();
  return inspectionRef.id;
}

export async function getInspection(inspectionId: string) {
  const snapshot = await getDoc(doc(requireDb(), 'inspections', inspectionId));
  if (!snapshot.exists()) throw new Error('Inspeção não encontrada.');
  return { id: snapshot.id, ...snapshot.data() } as Inspection;
}

export async function listInspectionItems(inspectionId: string) {
  const snapshot = await getDocs(
    query(collection(requireDb(), 'inspections', inspectionId, 'items'), orderBy('order')),
  );
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as InspectionItem);
}

export async function listInspections(projectIds: string[], isAdmin: boolean) {
  const inspectionsRef = collection(requireDb(), 'inspections');
  const snapshots = isAdmin
    ? [await getDocs(inspectionsRef)]
    : await Promise.all(
        projectIds
          .slice(0, 30)
          .map((projectId) => getDocs(query(inspectionsRef, where('projectId', '==', projectId)))),
      );

  return snapshots
    .flatMap((snapshot) =>
      snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Inspection),
    )
    .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
}

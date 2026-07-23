import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db } from '../lib/firebase/firestore';
import { functions } from '../lib/firebase/functions';
import type {
  ChecklistItemStatus,
  Inspection,
  InspectionItem,
  InspectionSummary,
} from '../types/inspection';
import type { Area } from '../types/project';

type StoredChecklistItemStatus =
  ChecklistItemStatus | 'approved' | 'partially_approved' | 'rejected';

interface StoredInspectionSummary {
  total?: number;
  notStarted?: number;
  ok?: number;
  punchList?: number;
  notApplicable?: number;
  approved?: number;
  partiallyApproved?: number;
  rejected?: number;
}

function normalizeItemStatus(status: StoredChecklistItemStatus): ChecklistItemStatus {
  if (status === 'approved') return 'ok';
  if (status === 'rejected' || status === 'partially_approved') return 'punch_list';
  return status;
}

function normalizeSummary(summary: StoredInspectionSummary): InspectionSummary {
  return {
    total: Number(summary.total || 0),
    notStarted: Number(summary.notStarted || 0),
    ok: Number(summary.ok ?? summary.approved ?? 0),
    punchList: Number(
      summary.punchList ?? Number(summary.rejected || 0) + Number(summary.partiallyApproved || 0),
    ),
    notApplicable: Number(summary.notApplicable || 0),
  };
}

function normalizeInspection(id: string, data: Record<string, unknown>): Inspection {
  return {
    id,
    ...data,
    summary: normalizeSummary((data.summary || {}) as StoredInspectionSummary),
  } as Inspection;
}

function requireDb() {
  if (!db) throw new Error('Firebase is not configured.');
  return db;
}

export async function createInspection(area: Area) {
  if (!functions) throw new Error('Firebase is not configured.');
  const create = httpsCallable<
    { projectId: string; areaId: string },
    {
      inspectionId: string;
      inspectionType: 'initial' | 'follow_up';
      sourceInspectionId?: string;
      itemCount: number;
      inheritedPhotoCount: number;
    }
  >(functions, 'createInspection');
  return (await create({ projectId: area.projectId, areaId: area.id })).data.inspectionId;
}

export async function getInspection(inspectionId: string) {
  const snapshot = await getDoc(doc(requireDb(), 'inspections', inspectionId));
  if (!snapshot.exists()) throw new Error('Inspection not found.');
  return normalizeInspection(snapshot.id, snapshot.data());
}

export async function listInspectionItems(inspectionId: string) {
  const snapshot = await getDocs(
    query(collection(requireDb(), 'inspections', inspectionId, 'items'), orderBy('order')),
  );
  return snapshot.docs.map((item) => {
    const data = item.data();
    return {
      id: item.id,
      ...data,
      status: normalizeItemStatus(data.status as StoredChecklistItemStatus),
    } as InspectionItem;
  });
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
    .flatMap((snapshot) => snapshot.docs.map((item) => normalizeInspection(item.id, item.data())))
    .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
}

const summaryKeys: Record<ChecklistItemStatus, keyof InspectionSummary> = {
  not_started: 'notStarted',
  ok: 'ok',
  punch_list: 'punchList',
  not_applicable: 'notApplicable',
};

export async function updateInspectionItem(
  inspectionId: string,
  itemId: string,
  changes: Pick<InspectionItem, 'status' | 'comment' | 'recommendation'>,
) {
  const firestore = requireDb();
  const inspectionRef = doc(firestore, 'inspections', inspectionId);
  const itemRef = doc(inspectionRef, 'items', itemId);

  return runTransaction(firestore, async (transaction) => {
    const inspectionSnapshot = await transaction.get(inspectionRef);
    const itemSnapshot = await transaction.get(itemRef);
    if (!inspectionSnapshot.exists() || !itemSnapshot.exists()) {
      throw new Error('Inspection or item not found.');
    }

    const inspection = inspectionSnapshot.data();
    const previousItem = itemSnapshot.data() as Omit<InspectionItem, 'status'> & {
      status: StoredChecklistItemStatus;
    };
    const previousStatus = normalizeItemStatus(previousItem.status);
    const summary = normalizeSummary(inspection.summary || {});
    if (previousStatus !== changes.status) {
      summary[summaryKeys[previousStatus]] -= 1;
      summary[summaryKeys[changes.status]] += 1;
    }

    transaction.update(itemRef, { ...changes, updatedAt: serverTimestamp() });
    transaction.update(inspectionRef, { summary, updatedAt: serverTimestamp() });
    return summary;
  });
}

export async function updateInspectionCoResponsible(inspectionId: string, name: string) {
  await updateDoc(doc(requireDb(), 'inspections', inspectionId), {
    coResponsibleName: name.trim(),
    updatedAt: serverTimestamp(),
  });
}

export async function finalizeInspection(inspectionId: string) {
  if (!functions) throw new Error('Firebase is not configured.');
  const finalize = httpsCallable<{ inspectionId: string }, { status: 'completed' }>(
    functions,
    'finalizeInspection',
  );
  return (await finalize({ inspectionId })).data;
}

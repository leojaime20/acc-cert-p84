import { FieldValue, type DocumentData, type DocumentReference } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { requireActiveUser } from '../shared/auth.js';
import { adminDb, adminStorage } from '../shared/firebase.js';
import {
  normalizeCarriedStatus,
  selectPunchListItems,
  summarizeStatuses,
} from './createInspectionData.js';

interface CreateInspectionRequest {
  projectId?: string;
  areaId?: string;
}

interface PendingWrite {
  reference: DocumentReference;
  data: DocumentData;
}

function validDocumentId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && !value.includes('/');
}

function inspectionCode(projectId: string, areaCode: unknown) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZone: 'Asia/Shanghai',
  })
    .formatToParts(new Date())
    .reduce<Record<string, string>>((result, part) => {
      if (part.type !== 'literal') result[part.type] = part.value;
      return result;
    }, {});
  const date = `${parts.year}${parts.month}${parts.day}`;
  const time = `${parts.hour}${parts.minute}${parts.second}`;
  return `${projectId.toUpperCase()}-${String(areaCode || 'AREA')}-${date}-${time}`;
}

async function commitWrites(writes: PendingWrite[]) {
  const chunkSize = 450;
  for (let start = 0; start < writes.length; start += chunkSize) {
    const batch = adminDb.batch();
    for (const write of writes.slice(start, start + chunkSize)) {
      batch.set(write.reference, write.data);
    }
    await batch.commit();
  }
}

export const createInspection = onCall<CreateInspectionRequest>(
  { region: 'asia-east2', enforceAppCheck: false, timeoutSeconds: 540 },
  async (request) => {
    const user = await requireActiveUser(request);
    const { projectId, areaId } = request.data;
    if (!validDocumentId(projectId) || !validDocumentId(areaId)) {
      throw new HttpsError('invalid-argument', 'A valid project and area are required.');
    }
    if (user.role !== 'admin' && !user.projectIds.includes(projectId)) {
      throw new HttpsError('permission-denied', 'Access denied.');
    }

    const areaRef = adminDb.doc(`projects/${projectId}/areas/${areaId}`);
    const areaSnapshot = await areaRef.get();
    if (!areaSnapshot.exists) throw new HttpsError('not-found', 'Area not found.');
    const area = areaSnapshot.data()!;
    if (area.active === false) throw new HttpsError('failed-precondition', 'The area is inactive.');

    const priorInspections = await adminDb
      .collection('inspections')
      .where('projectId', '==', projectId)
      .where('areaId', '==', areaId)
      .orderBy('inspectionDate', 'desc')
      .get();
    const sourceInspectionSnapshot = priorInspections.docs.find(
      (inspection) => inspection.data().status === 'completed',
    );
    const sourceInspection = sourceInspectionSnapshot?.data();

    let checklistTemplateId = String(area.checklistTemplateId || '');
    let checklistTemplateCode = '';
    let checklistTemplateVersion: number;
    let itemWrites: Array<{ id: string; data: DocumentData }>;

    if (sourceInspectionSnapshot && sourceInspection) {
      const sourceItemsSnapshot = await sourceInspectionSnapshot.ref
        .collection('items')
        .orderBy('order')
        .get();
      const sourceItems: Array<DocumentData & { id: string; status?: unknown }> =
        sourceItemsSnapshot.docs.map((item) => ({
          id: item.id,
          ...item.data(),
        }));
      const punchListItems = selectPunchListItems(sourceItems);
      if (punchListItems.length === 0) {
        throw new HttpsError(
          'failed-precondition',
          'The latest inspection has no Punch List items to reinspect.',
          { reason: 'no-punch-list-items', sourceInspectionId: sourceInspectionSnapshot.id },
        );
      }

      checklistTemplateId = String(
        sourceInspection.checklistTemplateId || area.checklistTemplateId || '',
      );
      checklistTemplateCode = String(sourceInspection.checklistTemplateCode || '');
      checklistTemplateVersion = Number(sourceInspection.checklistTemplateVersion || 0);
      itemWrites = sourceItems.map((item) => ({
        id: item.id,
        data: {
          templateItemId: item.templateItemId || item.id,
          itemNumber: item.itemNumber,
          code: item.code,
          description: item.description,
          verificationInstruction: item.verificationInstruction || item.description,
          order: item.order,
          required: item.required === true,
          photoRequired: item.photoRequired === true,
          status: normalizeCarriedStatus(item.status),
          comment: typeof item.comment === 'string' ? item.comment : '',
          recommendation: typeof item.recommendation === 'string' ? item.recommendation : '',
          sourceInspectionId: sourceInspectionSnapshot.id,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
      }));
    } else {
      if (!checklistTemplateId) {
        throw new HttpsError('failed-precondition', 'The area has no checklist.');
      }
      const templateRef = adminDb.doc(`checklistTemplates/${checklistTemplateId}`);
      const [templateSnapshot, templateItemsSnapshot] = await Promise.all([
        templateRef.get(),
        templateRef.collection('items').orderBy('order').get(),
      ]);
      if (!templateSnapshot.exists) throw new HttpsError('not-found', 'Area checklist not found.');
      const template = templateSnapshot.data()!;
      const activeItems = templateItemsSnapshot.docs
        .map<DocumentData & { id: string }>((item) => ({ id: item.id, ...item.data() }))
        .filter((item) => item.active === true);
      if (activeItems.length === 0) {
        throw new HttpsError('failed-precondition', 'The checklist has no active items.');
      }

      checklistTemplateCode = String(template.code || '');
      checklistTemplateVersion = Number(template.version || 0);
      itemWrites = activeItems.map((item) => ({
        id: item.id,
        data: {
          templateItemId: item.id,
          itemNumber: item.itemNumber,
          code: `${checklistTemplateCode}-${String(item.itemNumber).padStart(2, '0')}`,
          description: item.description,
          verificationInstruction: item.verificationInstruction || item.description,
          order: item.order,
          required: item.required === true,
          photoRequired: item.photoRequired === true,
          status: 'not_started',
          comment: '',
          recommendation: '',
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
      }));
    }

    const inspectionRef = adminDb.collection('inspections').doc();
    const bucket = adminStorage.bucket();
    const copiedStoragePaths: string[] = [];
    const photoWrites: PendingWrite[] = [];

    try {
      if (sourceInspectionSnapshot) {
        const sourcePhotos = await sourceInspectionSnapshot.ref.collection('photos').get();
        const includedItemIds = new Set(itemWrites.map((item) => item.id));
        for (const sourcePhotoSnapshot of sourcePhotos.docs) {
          const sourcePhoto = sourcePhotoSnapshot.data();
          if (
            (sourcePhoto.uploadStatus && sourcePhoto.uploadStatus !== 'completed') ||
            typeof sourcePhoto.itemId !== 'string' ||
            !includedItemIds.has(sourcePhoto.itemId) ||
            typeof sourcePhoto.storagePath !== 'string'
          ) {
            continue;
          }
          const sourceFile = bucket.file(sourcePhoto.storagePath);
          const [exists] = await sourceFile.exists();
          if (!exists) continue;

          const photoRef = inspectionRef.collection('photos').doc();
          const storagePath = `inspections/${inspectionRef.id}/items/${sourcePhoto.itemId}/${photoRef.id}.jpg`;
          await sourceFile.copy(bucket.file(storagePath));
          copiedStoragePaths.push(storagePath);
          photoWrites.push({
            reference: photoRef,
            data: {
              ...sourcePhoto,
              itemId: sourcePhoto.itemId,
              category: 'item',
              storagePath,
              uploadStatus: 'completed',
              inheritedFromInspectionId: sourceInspectionSnapshot.id,
              inheritedFromPhotoId: sourcePhotoSnapshot.id,
              createdAt: FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp(),
            },
          });
        }
      }

      const isFollowUp = Boolean(sourceInspectionSnapshot);
      const inspectionData: DocumentData = {
        code: inspectionCode(projectId, area.code),
        projectId,
        areaId,
        areaCode: area.code,
        areaName: area.name,
        areaLocation: area.location,
        checklistTemplateId,
        checklistTemplateCode,
        checklistTemplateVersion,
        inspectorId: user.uid,
        inspectorName: user.name,
        inspectorEmail:
          user.email ||
          (typeof request.auth?.token.email === 'string' ? request.auth.token.email : ''),
        status: 'draft',
        inspectionType: isFollowUp ? 'follow_up' : 'initial',
        inspectionDate: FieldValue.serverTimestamp(),
        summary: summarizeStatuses(
          itemWrites.map((item) => normalizeCarriedStatus(item.data.status)),
        ),
        inheritedPhotoCount: photoWrites.length,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (sourceInspectionSnapshot) {
        inspectionData.sourceInspectionId = sourceInspectionSnapshot.id;
        inspectionData.sourceInspectionCode = sourceInspection?.code || sourceInspectionSnapshot.id;
      }

      const writes: PendingWrite[] = [
        { reference: inspectionRef, data: inspectionData },
        ...itemWrites.map((item) => ({
          reference: inspectionRef.collection('items').doc(item.id),
          data: item.data,
        })),
        ...photoWrites,
        {
          reference: adminDb.collection('auditLogs').doc(),
          data: {
            userId: user.uid,
            action: 'inspection.created',
            entityType: 'inspection',
            entityId: inspectionRef.id,
            projectId,
            inspectionId: inspectionRef.id,
            sourceInspectionId: sourceInspectionSnapshot?.id || null,
            createdAt: FieldValue.serverTimestamp(),
          },
        },
      ];
      await commitWrites(writes);

      return {
        inspectionId: inspectionRef.id,
        inspectionType: isFollowUp ? 'follow_up' : 'initial',
        sourceInspectionId: sourceInspectionSnapshot?.id,
        itemCount: itemWrites.length,
        inheritedPhotoCount: photoWrites.length,
      };
    } catch (error) {
      await Promise.all(
        copiedStoragePaths.map((storagePath) =>
          bucket
            .file(storagePath)
            .delete({ ignoreNotFound: true })
            .catch(() => undefined),
        ),
      );
      await adminDb.recursiveDelete(inspectionRef).catch(() => undefined);
      if (error instanceof HttpsError) throw error;
      throw new HttpsError('internal', 'Unable to create the inspection follow-up.');
    }
  },
);

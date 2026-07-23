import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { requireActiveUser } from '../shared/auth.js';
import { adminDb } from '../shared/firebase.js';

interface FinalizeRequest {
  inspectionId?: string;
}

export const finalizeInspection = onCall<FinalizeRequest>(
  { region: 'asia-east2', enforceAppCheck: false },
  async (request) => {
    const user = await requireActiveUser(request);
    const inspectionId = request.data.inspectionId?.trim();
    if (!inspectionId) throw new HttpsError('invalid-argument', 'Inspection is required.');

    const inspectionRef = adminDb.doc(`inspections/${inspectionId}`);

    await adminDb.runTransaction(async (transaction) => {
      const inspectionSnapshot = await transaction.get(inspectionRef);
      if (!inspectionSnapshot.exists) throw new HttpsError('not-found', 'Inspection not found.');
      const inspection = inspectionSnapshot.data()!;
      const canFinalize =
        user.role === 'admin' ||
        (inspection.inspectorId === user.uid && user.projectIds.includes(inspection.projectId));
      if (!canFinalize) throw new HttpsError('permission-denied', 'Access denied.');
      if (!['draft', 'reopened'].includes(inspection.status)) {
        throw new HttpsError('failed-precondition', 'The inspection is not open.');
      }

      const itemSnapshots = await transaction.get(inspectionRef.collection('items'));
      const photoSnapshots = await transaction.get(inspectionRef.collection('photos'));
      const photos = photoSnapshots.docs.map((photo) => photo.data());
      const pending: string[] = [];
      const summary = {
        total: itemSnapshots.size,
        notStarted: 0,
        ok: 0,
        punchList: 0,
        notApplicable: 0,
      };

      if (itemSnapshots.empty) pending.push('The inspection checklist has no items.');

      for (const itemSnapshot of itemSnapshots.docs) {
        const item = itemSnapshot.data();
        if (item.status === 'not_started') summary.notStarted += 1;
        if (['ok', 'approved'].includes(item.status)) summary.ok += 1;
        if (['punch_list', 'rejected', 'partially_approved'].includes(item.status)) {
          summary.punchList += 1;
        }
        if (item.status === 'not_applicable') summary.notApplicable += 1;
        const label = item.code || `Item ${item.itemNumber || itemSnapshot.id}`;
        if (item.required && item.status === 'not_started') pending.push(`${label}: not verified`);
        if (
          ['punch_list', 'rejected', 'partially_approved'].includes(item.status) &&
          !item.comment?.trim()
        ) {
          pending.push(`${label}: comment is required`);
        }
        if (item.photoRequired && !photos.some((photo) => photo.itemId === itemSnapshot.id)) {
          pending.push(`${label}: photo is required`);
        }
      }

      if (photos.some((photo) => photo.uploadStatus && photo.uploadStatus !== 'completed')) {
        pending.push('There are photos with pending uploads.');
      }
      if (pending.length) {
        throw new HttpsError('failed-precondition', 'The inspection has pending items.', {
          pending,
        });
      }

      transaction.update(inspectionRef, {
        status: 'completed',
        completedAt: FieldValue.serverTimestamp(),
        completedBy: user.uid,
        summary,
        updatedAt: FieldValue.serverTimestamp(),
        reportStatus: 'pending',
        reportError: FieldValue.delete(),
      });

      const auditRef = adminDb.collection('auditLogs').doc();
      transaction.create(auditRef, {
        userId: user.uid,
        action: 'inspection.completed',
        entityType: 'inspection',
        entityId: inspectionId,
        projectId: inspection.projectId,
        inspectionId,
        createdAt: FieldValue.serverTimestamp(),
      });
    });

    return { inspectionId, status: 'completed' };
  },
);

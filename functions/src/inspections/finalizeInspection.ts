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
    if (!inspectionId) throw new HttpsError('invalid-argument', 'Inspeção obrigatória.');

    const inspectionRef = adminDb.doc(`inspections/${inspectionId}`);

    await adminDb.runTransaction(async (transaction) => {
      const inspectionSnapshot = await transaction.get(inspectionRef);
      if (!inspectionSnapshot.exists) throw new HttpsError('not-found', 'Inspeção não encontrada.');
      const inspection = inspectionSnapshot.data()!;
      const canFinalize =
        user.role === 'admin' ||
        (inspection.inspectorId === user.uid && user.projectIds.includes(inspection.projectId));
      if (!canFinalize) throw new HttpsError('permission-denied', 'Acesso negado.');
      if (!['draft', 'reopened'].includes(inspection.status)) {
        throw new HttpsError('failed-precondition', 'A inspeção não está aberta.');
      }

      const itemSnapshots = await transaction.get(inspectionRef.collection('items'));
      const photoSnapshots = await transaction.get(inspectionRef.collection('photos'));
      const photos = photoSnapshots.docs.map((photo) => photo.data());
      const pending: string[] = [];
      const summary = {
        total: itemSnapshots.size,
        notStarted: 0,
        approved: 0,
        partiallyApproved: 0,
        rejected: 0,
        notApplicable: 0,
      };

      if (itemSnapshots.empty) pending.push('O checklist da inspeção não possui itens.');

      for (const itemSnapshot of itemSnapshots.docs) {
        const item = itemSnapshot.data();
        if (item.status === 'not_started') summary.notStarted += 1;
        if (item.status === 'approved') summary.approved += 1;
        if (item.status === 'partially_approved') summary.partiallyApproved += 1;
        if (item.status === 'rejected') summary.rejected += 1;
        if (item.status === 'not_applicable') summary.notApplicable += 1;
        const label = item.code || `Item ${item.itemNumber || itemSnapshot.id}`;
        if (item.required && item.status === 'not_started')
          pending.push(`${label}: não verificado`);
        if (['rejected', 'partially_approved'].includes(item.status) && !item.comment?.trim()) {
          pending.push(`${label}: comentário obrigatório`);
        }
        if (item.status === 'rejected' && !item.recommendation?.trim()) {
          pending.push(`${label}: recomendação obrigatória`);
        }
        if (item.photoRequired && !photos.some((photo) => photo.itemId === itemSnapshot.id)) {
          pending.push(`${label}: fotografia obrigatória`);
        }
      }

      if (photos.some((photo) => photo.uploadStatus && photo.uploadStatus !== 'completed')) {
        pending.push('Existem fotografias com upload pendente.');
      }
      if (pending.length) {
        throw new HttpsError('failed-precondition', 'A inspeção possui pendências.', { pending });
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

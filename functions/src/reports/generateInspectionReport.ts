import { FieldValue } from 'firebase-admin/firestore';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { adminDb, adminStorage } from '../shared/firebase.js';

async function createPdf(
  inspection: FirebaseFirestore.DocumentData,
  items: FirebaseFirestore.DocumentData[],
) {
  const { default: PDFDocument } = await import('pdfkit');
  return new Promise<Buffer>((resolve, reject) => {
    const document = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true });
    const chunks: Buffer[] = [];
    document.on('data', (chunk: Buffer) => chunks.push(chunk));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);

    document.fontSize(20).fillColor('#102b3f').text('Relatório de Inspeção');
    document.moveDown();
    document.fontSize(11).fillColor('#17232b');
    document.text(`Código: ${inspection.code}`);
    document.text(`Obra: ${inspection.projectSnapshot?.name || inspection.projectId}`);
    document.text(
      `Área: ${inspection.areaSnapshot?.code || inspection.areaId} — ${inspection.areaSnapshot?.name || ''}`,
    );
    document.text(`Responsável: ${inspection.inspectorName}`);
    document.moveDown();
    document.fontSize(14).text('Resumo');
    document
      .fontSize(10)
      .text(
        `Aprovados: ${inspection.summary?.approved || 0}  |  Parciais: ${inspection.summary?.partiallyApproved || 0}  |  Reprovados: ${inspection.summary?.rejected || 0}  |  N/A: ${inspection.summary?.notApplicable || 0}`,
      );
    document.moveDown();

    for (const item of items) {
      if (document.y > 700) document.addPage();
      document
        .fontSize(10)
        .fillColor('#102b3f')
        .text(`${item.code} — ${item.status}`, { continued: false });
      document
        .fontSize(9)
        .fillColor('#17232b')
        .text(item.description || item.title || '');
      if (item.comment) document.text(`Comentário: ${item.comment}`);
      if (item.recommendation) document.text(`Recomendação: ${item.recommendation}`);
      document.moveDown(0.7);
    }

    const range = document.bufferedPageRange();
    for (let page = 0; page < range.count; page += 1) {
      document.switchToPage(page);
      document
        .fontSize(8)
        .fillColor('#60717a')
        .text(`ACC Cert • Página ${page + 1} de ${range.count}`, 48, 790, {
          align: 'center',
          width: 500,
        });
    }
    document.end();
  });
}

export const generateInspectionReport = onDocumentUpdated(
  {
    document: 'inspections/{inspectionId}',
    region: 'asia-east2',
    memory: '1GiB',
    timeoutSeconds: 300,
  },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    const inspectionId = event.params.inspectionId;
    if (!after || after.reportStatus !== 'pending' || before?.reportStatus === 'pending') return;

    const inspectionRef = adminDb.doc(`inspections/${inspectionId}`);
    await inspectionRef.update({ reportStatus: 'processing', reportError: FieldValue.delete() });

    try {
      const itemsSnapshot = await inspectionRef.collection('items').orderBy('order').get();
      const pdf = await createPdf(
        after,
        itemsSnapshot.docs.map((item) => item.data()),
      );
      const storagePath = `inspections/${inspectionId}/reports/relatorio-${inspectionId}.pdf`;
      await adminStorage
        .bucket()
        .file(storagePath)
        .save(pdf, {
          contentType: 'application/pdf',
          resumable: false,
          metadata: { cacheControl: 'private, max-age=0' },
        });
      await inspectionRef.update({
        reportStatus: 'completed',
        reportStoragePath: storagePath,
        reportGeneratedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      await adminDb.collection('auditLogs').add({
        userId: 'system',
        action: 'report.generated',
        entityType: 'inspection',
        entityId: inspectionId,
        projectId: after.projectId,
        inspectionId,
        metadata: { storagePath },
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha desconhecida';
      await inspectionRef.update({ reportStatus: 'error', reportError: message });
      throw error;
    }
  },
);

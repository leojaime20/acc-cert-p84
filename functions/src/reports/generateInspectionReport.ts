import { FieldValue } from 'firebase-admin/firestore';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { adminDb, adminStorage } from '../shared/firebase.js';

const COLORS = {
  green: '#007e3f',
  greenDark: '#005d32',
  greenSoft: '#edf7f1',
  yellow: '#f4d329',
  ink: '#17232b',
  muted: '#60717a',
  line: '#d9e2dd',
  panel: '#f6f8f7',
  white: '#ffffff',
  red: '#a92f2f',
  redSoft: '#fbeeee',
  blue: '#245b8f',
  blueSoft: '#edf4fb',
};

const PAGE = {
  left: 40,
  right: 40,
  top: 88,
  bottom: 54,
  width: 515,
};

const STATUS: Record<string, { label: string; color: string; background: string }> = {
  not_started: { label: 'Pending', color: COLORS.muted, background: '#eef1f2' },
  ok: { label: 'Ok', color: COLORS.greenDark, background: COLORS.greenSoft },
  punch_list: { label: 'Punch List', color: COLORS.red, background: COLORS.redSoft },
  approved: { label: 'Ok', color: COLORS.greenDark, background: COLORS.greenSoft },
  partially_approved: { label: 'Punch List', color: COLORS.red, background: COLORS.redSoft },
  rejected: { label: 'Punch List', color: COLORS.red, background: COLORS.redSoft },
  not_applicable: { label: 'Not applicable', color: COLORS.blue, background: COLORS.blueSoft },
};

function text(value: unknown, fallback = 'Not provided') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function timestampDate(value: unknown) {
  if (value instanceof Date) return value;
  if (typeof value === 'object' && value && 'toDate' in value) {
    const toDate = (value as { toDate?: unknown }).toDate;
    if (typeof toDate === 'function') return toDate.call(value) as Date;
  }
  if (typeof value === 'object' && value && '_seconds' in value) {
    return new Date(Number((value as { _seconds: unknown })._seconds) * 1000);
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return null;
}

function formatInspectionDate(value: unknown) {
  const date = timestampDate(value);
  if (!date) return 'Not provided';
  return new Intl.DateTimeFormat('en', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function formatGeneratedAt(date: Date) {
  return new Intl.DateTimeFormat('en', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(date);
}

function statusInfo(status: unknown) {
  return (
    STATUS[String(status)] || {
      label: text(status, 'Not provided'),
      color: COLORS.muted,
      background: '#eef1f2',
    }
  );
}

export async function createInspectionPdf(
  inspection: FirebaseFirestore.DocumentData,
  items: FirebaseFirestore.DocumentData[],
  photos: Array<FirebaseFirestore.DocumentData & { buffer: Buffer }>,
) {
  const { default: PDFDocument } = await import('pdfkit');

  return new Promise<Buffer>((resolve, reject) => {
    const document = new PDFDocument({
      size: 'A4',
      margin: 0,
      bufferPages: true,
      info: {
        Title: `Inspection Report - ${text(inspection.code, 'AC Certificate')}`,
        Author: 'AC Certificate',
        Subject: 'Technical inspection and area certification report',
      },
    });
    const chunks: Buffer[] = [];
    const generatedAt = new Date();
    document.on('data', (chunk: Buffer) => chunks.push(chunk));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);

    function drawCoverHeader() {
      document.save();
      document.rect(0, 0, document.page.width, 66).fill(COLORS.green);
      document.rect(0, 66, document.page.width, 5).fill(COLORS.yellow);
      document
        .font('Helvetica-Bold')
        .fontSize(15)
        .fillColor(COLORS.white)
        .text('AC CERTIFICATE', PAGE.left, 18, { width: 180 });
      document
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor('#d8eee2')
        .text('AREA INSPECTION AND CERTIFICATION', PAGE.left, 39, { width: 240 });
      document
        .font('Helvetica-Bold')
        .fontSize(9)
        .fillColor(COLORS.white)
        .text(text(inspection.code, 'TECHNICAL REPORT'), 320, 25, {
          width: 235,
          align: 'right',
        });
      document.restore();
      document.x = PAGE.left;
      document.y = PAGE.top;
    }

    function drawContinuationHeader() {
      document.rect(0, 0, document.page.width, 10).fill(COLORS.green);
      document.rect(0, 10, document.page.width, 3).fill(COLORS.yellow);
      document.x = PAGE.left;
      document.y = 32;
    }

    function addPage(sectionContinuation?: string) {
      document.addPage();
      drawContinuationHeader();
      if (sectionContinuation) {
        document
          .font('Helvetica-Bold')
          .fontSize(8)
          .fillColor(COLORS.greenDark)
          .text(`${sectionContinuation.toUpperCase()} - CONTINUED`, PAGE.left, document.y, {
            characterSpacing: 0.7,
          });
        document.y += 20;
      }
    }

    function ensureSpace(height: number, continuation?: string) {
      const limit = document.page.height - PAGE.bottom;
      if (document.y + height > limit) addPage(continuation);
    }

    function sectionTitle(title: string, subtitle?: string) {
      ensureSpace(subtitle ? 48 : 34, title);
      const y = document.y;
      document.rect(PAGE.left, y, 5, subtitle ? 34 : 24).fill(COLORS.green);
      document
        .font('Helvetica-Bold')
        .fontSize(12)
        .fillColor(COLORS.ink)
        .text(title, PAGE.left + 14, y + 1, { width: PAGE.width - 14 });
      if (subtitle) {
        document
          .font('Helvetica')
          .fontSize(8)
          .fillColor(COLORS.muted)
          .text(subtitle, PAGE.left + 14, y + 19, { width: PAGE.width - 14 });
      }
      document.y = y + (subtitle ? 45 : 34);
    }

    function field(
      x: number,
      y: number,
      width: number,
      label: string,
      value: unknown,
      options: { highlighted?: boolean; height?: number } = {},
    ) {
      const height = options.height || 49;
      document
        .roundedRect(x, y, width, height, 4)
        .fillAndStroke(
          options.highlighted ? COLORS.greenSoft : COLORS.white,
          options.highlighted ? COLORS.green : COLORS.line,
        );
      document
        .font('Helvetica-Bold')
        .fontSize(6.5)
        .fillColor(options.highlighted ? COLORS.greenDark : COLORS.muted)
        .text(label.toUpperCase(), x + 10, y + 8, { width: width - 20, characterSpacing: 0.55 });
      document
        .font(options.highlighted ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(options.highlighted ? 11 : 9)
        .fillColor(COLORS.ink)
        .text(text(value), x + 10, y + 24, {
          width: width - 20,
          height: height - 28,
          ellipsis: true,
        });
    }

    function summaryCard(
      x: number,
      y: number,
      width: number,
      value: number,
      label: string,
      color: string,
      background: string,
    ) {
      document.roundedRect(x, y, width, 53, 5).fillAndStroke(background, color);
      document
        .font('Helvetica-Bold')
        .fontSize(16)
        .fillColor(color)
        .text(String(value), x + 8, y + 9, { width: width - 16, align: 'center' });
      document
        .font('Helvetica-Bold')
        .fontSize(6.5)
        .fillColor(COLORS.muted)
        .text(label.toUpperCase(), x + 5, y + 33, {
          width: width - 10,
          align: 'center',
          characterSpacing: 0.25,
        });
    }

    function photoCard(
      photo: FirebaseFirestore.DocumentData & { buffer: Buffer },
      x: number,
      y: number,
    ) {
      const width = 251;
      const height = 160;
      document.roundedRect(x, y, width, height, 5).fillAndStroke(COLORS.white, COLORS.line);
      document.roundedRect(x + 7, y + 7, width - 14, 116, 3).fill(COLORS.panel);
      document.image(photo.buffer, x + 7, y + 7, {
        fit: [width - 14, 116],
        align: 'center',
        valign: 'center',
      });
      document
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor(COLORS.ink)
        .text(text(photo.caption, 'Photo evidence without a caption'), x + 9, y + 131, {
          width: width - 18,
          height: 21,
          ellipsis: true,
        });
    }

    function photoRows(
      photoList: Array<FirebaseFirestore.DocumentData & { buffer: Buffer }>,
      continuation: string,
    ) {
      for (let index = 0; index < photoList.length; index += 2) {
        ensureSpace(174, continuation);
        const y = document.y;
        const first = photoList[index];
        const second = photoList[index + 1];
        if (first) photoCard(first, PAGE.left, y);
        if (second) photoCard(second, PAGE.left + 264, y);
        document.y = y + 174;
      }
    }

    function labeledTextHeight(value: unknown, width: number) {
      document.font('Helvetica').fontSize(8.5);
      return Math.max(15, document.heightOfString(text(value), { width }));
    }

    function itemDetails(item: FirebaseFirestore.DocumentData) {
      const cardWidth = PAGE.width;
      const innerWidth = cardWidth - 24;
      const description = text(item.description || item.title);
      const instruction = text(item.verificationInstruction, 'Not specified');
      const comment = text(item.comment);
      const recommendation = text(item.recommendation);
      const descriptionHeight = labeledTextHeight(description, innerWidth);
      const instructionHeight = labeledTextHeight(instruction, innerWidth);
      const columnWidth = (innerWidth - 12) / 2;
      const commentHeight = labeledTextHeight(comment, columnWidth - 16);
      const recommendationHeight = labeledTextHeight(recommendation, columnWidth - 16);
      const notesHeight = Math.max(54, Math.max(commentHeight, recommendationHeight) + 30);
      const height = 42 + 25 + descriptionHeight + 24 + instructionHeight + 39 + notesHeight + 14;

      ensureSpace(Math.min(height, 620), 'Inspection checklist');
      const y = document.y;
      const info = statusInfo(item.status);
      document
        .roundedRect(PAGE.left, y, cardWidth, height, 6)
        .fillAndStroke(COLORS.white, COLORS.line);
      document.roundedRect(PAGE.left, y, cardWidth, 38, 6).fill(COLORS.greenSoft);
      document.rect(PAGE.left, y + 31, cardWidth, 7).fill(COLORS.greenSoft);
      document
        .font('Helvetica-Bold')
        .fontSize(10)
        .fillColor(COLORS.greenDark)
        .text(text(item.code, `ITEM ${item.itemNumber || ''}`), PAGE.left + 12, y + 13, {
          width: 260,
        });
      const pillWidth = Math.min(150, Math.max(78, document.widthOfString(info.label) + 24));
      document
        .roundedRect(PAGE.left + cardWidth - pillWidth - 12, y + 9, pillWidth, 21, 10)
        .fill(info.background);
      document
        .font('Helvetica-Bold')
        .fontSize(7)
        .fillColor(info.color)
        .text(info.label.toUpperCase(), PAGE.left + cardWidth - pillWidth - 12, y + 16, {
          width: pillWidth,
          align: 'center',
        });

      let cursor = y + 49;
      document
        .font('Helvetica-Bold')
        .fontSize(6.5)
        .fillColor(COLORS.muted)
        .text('ITEM DESCRIPTION', PAGE.left + 12, cursor, { characterSpacing: 0.45 });
      cursor += 13;
      document
        .font('Helvetica')
        .fontSize(8.5)
        .fillColor(COLORS.ink)
        .text(description, PAGE.left + 12, cursor, { width: innerWidth });
      cursor += descriptionHeight + 12;
      document
        .moveTo(PAGE.left + 12, cursor)
        .lineTo(PAGE.left + cardWidth - 12, cursor)
        .strokeColor(COLORS.line)
        .stroke();
      cursor += 10;

      document
        .font('Helvetica-Bold')
        .fontSize(6.5)
        .fillColor(COLORS.muted)
        .text('VERIFICATION INSTRUCTION', PAGE.left + 12, cursor, { characterSpacing: 0.45 });
      cursor += 13;
      document
        .font('Helvetica')
        .fontSize(8.5)
        .fillColor(COLORS.ink)
        .text(instruction, PAGE.left + 12, cursor, { width: innerWidth });
      cursor += instructionHeight + 12;

      document
        .roundedRect(PAGE.left + 12, cursor, columnWidth, notesHeight, 4)
        .fillAndStroke(COLORS.panel, COLORS.line);
      document
        .roundedRect(PAGE.left + 24 + columnWidth, cursor, columnWidth, notesHeight, 4)
        .fillAndStroke(COLORS.panel, COLORS.line);
      document
        .font('Helvetica-Bold')
        .fontSize(6.5)
        .fillColor(COLORS.muted)
        .text('COMMENT', PAGE.left + 20, cursor + 9, { characterSpacing: 0.45 });
      document
        .font('Helvetica')
        .fontSize(8.5)
        .fillColor(COLORS.ink)
        .text(comment, PAGE.left + 20, cursor + 23, { width: columnWidth - 16 });
      document
        .font('Helvetica-Bold')
        .fontSize(6.5)
        .fillColor(COLORS.muted)
        .text('RECOMMENDATION', PAGE.left + 32 + columnWidth, cursor + 9, {
          characterSpacing: 0.45,
        });
      document
        .font('Helvetica')
        .fontSize(8.5)
        .fillColor(COLORS.ink)
        .text(recommendation, PAGE.left + 32 + columnWidth, cursor + 23, {
          width: columnWidth - 16,
        });
      document.y = y + height + 10;
    }

    drawCoverHeader();
    document
      .font('Helvetica-Bold')
      .fontSize(20)
      .fillColor(COLORS.ink)
      .text('Technical inspection report', PAGE.left, document.y, { width: PAGE.width });
    document.y += 32;

    const y1 = document.y;
    field(PAGE.left, y1, 331, 'Inspection code', inspection.code);
    field(
      PAGE.left + 340,
      y1,
      175,
      'Inspection date',
      formatInspectionDate(inspection.inspectionDate),
      {
        highlighted: true,
      },
    );
    const y2 = y1 + 58;
    field(PAGE.left, y2, 253, 'Project', inspection.projectSnapshot?.name || inspection.projectId);
    field(
      PAGE.left + 262,
      y2,
      253,
      'Applied checklist',
      inspection.checklistTemplateCode || inspection.checklistTemplateId,
    );
    const y3 = y2 + 58;
    field(
      PAGE.left,
      y3,
      PAGE.width,
      'Inspected area',
      `${text(inspection.areaSnapshot?.code || inspection.areaCode || inspection.areaId, '')} - ${text(inspection.areaSnapshot?.name || inspection.areaName, '')}`.replace(
        /^ - | - $/g,
        '',
      ),
    );
    const y4 = y3 + 58;
    field(PAGE.left, y4, 253, 'Location / deck', inspection.areaLocation);
    field(
      PAGE.left + 262,
      y4,
      253,
      'Document status',
      inspection.sourceInspectionCode
        ? `Follow-up of ${inspection.sourceInspectionCode}`
        : 'Inspection completed',
    );
    const y5 = y4 + 58;
    field(PAGE.left, y5, 253, 'Responsible inspector', inspection.inspectorName);
    field(PAGE.left + 262, y5, 253, 'Inspector email', inspection.inspectorEmail);
    const y6 = y5 + 58;
    field(
      PAGE.left,
      y6,
      PAGE.width,
      'Co-responsible person',
      text(inspection.coResponsibleName, 'Not assigned'),
    );
    document.y = y6 + 65;

    sectionTitle('Results summary', 'Summary of items recorded in the checklist');
    const cardGap = 7;
    const cardWidth = (PAGE.width - cardGap * 3) / 4;
    const summaryY = document.y;
    summaryCard(
      PAGE.left,
      summaryY,
      cardWidth,
      Number(inspection.summary?.ok ?? inspection.summary?.approved ?? 0),
      'Ok',
      COLORS.greenDark,
      COLORS.greenSoft,
    );
    summaryCard(
      PAGE.left + (cardWidth + cardGap),
      summaryY,
      cardWidth,
      Number(
        inspection.summary?.punchList ??
          Number(inspection.summary?.rejected || 0) +
            Number(inspection.summary?.partiallyApproved || 0),
      ),
      'Punch List',
      COLORS.red,
      COLORS.redSoft,
    );
    summaryCard(
      PAGE.left + (cardWidth + cardGap) * 2,
      summaryY,
      cardWidth,
      Number(inspection.summary?.notApplicable || 0),
      'Not applicable',
      COLORS.blue,
      COLORS.blueSoft,
    );
    summaryCard(
      PAGE.left + (cardWidth + cardGap) * 3,
      summaryY,
      cardWidth,
      Number(inspection.summary?.total || items.length),
      'Total',
      COLORS.ink,
      '#eef1f2',
    );
    document.y = summaryY + 68;

    const generalPhotos = photos.filter((photo) => !photo.itemId);
    if (generalPhotos.length) {
      sectionTitle(
        'General area evidence',
        `${generalPhotos.length} photo(s) linked to the inspection`,
      );
      photoRows(generalPhotos, 'General area evidence');
    }

    sectionTitle(
      'Inspection checklist',
      `${items.length} ${items.length === 1 ? 'item evaluated' : 'items evaluated'} individually`,
    );
    for (const item of items) {
      itemDetails(item);
      const itemPhotos = photos.filter((photo) => photo.itemId === item.id);
      if (itemPhotos.length) {
        ensureSpace(26, 'Inspection checklist');
        document
          .font('Helvetica-Bold')
          .fontSize(7)
          .fillColor(COLORS.greenDark)
          .text(`ITEM PHOTO EVIDENCE (${itemPhotos.length})`, PAGE.left + 5, document.y, {
            characterSpacing: 0.45,
          });
        document.y += 17;
        photoRows(itemPhotos, `Evidence for item ${text(item.code, '')}`);
      }
      document.y += 4;
    }

    ensureSpace(76, 'Closing');
    const closingY = document.y + 4;
    document
      .roundedRect(PAGE.left, closingY, PAGE.width, 60, 5)
      .fillAndStroke(COLORS.panel, COLORS.line);
    document
      .font('Helvetica-Bold')
      .fontSize(7)
      .fillColor(COLORS.muted)
      .text('DOCUMENT RECORD', PAGE.left + 12, closingY + 10, { characterSpacing: 0.5 });
    document
      .font('Helvetica')
      .fontSize(8)
      .fillColor(COLORS.ink)
      .text(
        `Generated automatically by AC Certificate on ${formatGeneratedAt(generatedAt)}.`,
        PAGE.left + 12,
        closingY + 26,
        {
          width: PAGE.width - 24,
        },
      );
    document
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(COLORS.muted)
      .text(
        'This report consolidates the data and evidence recorded electronically during the inspection.',
        PAGE.left + 12,
        closingY + 41,
        {
          width: PAGE.width - 24,
        },
      );

    const range = document.bufferedPageRange();
    for (let page = 0; page < range.count; page += 1) {
      document.switchToPage(page);
      const footerY = document.page.height - 35;
      document
        .moveTo(PAGE.left, footerY - 8)
        .lineTo(document.page.width - PAGE.right, footerY - 8)
        .strokeColor(COLORS.line)
        .stroke();
      document
        .font('Helvetica')
        .fontSize(7)
        .fillColor(COLORS.muted)
        .text('AC Certificate - Technical inspection report', PAGE.left, footerY, { width: 290 });
      document
        .font('Helvetica-Bold')
        .fontSize(7)
        .fillColor(COLORS.muted)
        .text(`Page ${page + 1} / ${range.count}`, 390, footerY, { width: 165, align: 'right' });
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

    let storagePath = '';
    try {
      const [itemsSnapshot, photosSnapshot] = await Promise.all([
        inspectionRef.collection('items').orderBy('order').get(),
        inspectionRef.collection('photos').orderBy('order').get(),
      ]);
      const items = itemsSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      const photos = await Promise.all(
        photosSnapshot.docs.map(async (photo) => {
          const data = photo.data();
          const [buffer] = await adminStorage.bucket().file(data.storagePath).download();
          return { id: photo.id, ...data, buffer };
        }),
      );
      const pdf = await createInspectionPdf(after, items, photos);
      storagePath = `inspections/${inspectionId}/reports/report-${inspectionId}.pdf`;
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
      const currentInspection = await inspectionRef.get();
      if (!currentInspection.exists) {
        if (storagePath) {
          await adminStorage.bucket().file(storagePath).delete({ ignoreNotFound: true });
        }
        return;
      }
      const message = error instanceof Error ? error.message : 'Unknown error';
      await inspectionRef.update({ reportStatus: 'error', reportError: message });
      throw error;
    }
  },
);

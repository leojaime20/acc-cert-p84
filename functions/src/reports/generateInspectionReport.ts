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
  amber: '#9a6400',
  amberSoft: '#fff6dc',
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
  not_started: { label: 'Pendente', color: COLORS.muted, background: '#eef1f2' },
  approved: { label: 'Aprovado', color: COLORS.greenDark, background: COLORS.greenSoft },
  partially_approved: {
    label: 'Aprovado parcialmente',
    color: COLORS.amber,
    background: COLORS.amberSoft,
  },
  rejected: { label: 'Reprovado', color: COLORS.red, background: COLORS.redSoft },
  not_applicable: { label: 'Não aplicável', color: COLORS.blue, background: COLORS.blueSoft },
};

function text(value: unknown, fallback = 'Não informado') {
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
  if (!date) return 'Não informada';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function formatGeneratedAt(date: Date) {
  return new Intl.DateTimeFormat('pt-BR', {
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
      label: text(status, 'Não informado'),
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
        Title: `Relatório de Inspeção - ${text(inspection.code, 'ACC Cert')}`,
        Author: 'ACC Cert',
        Subject: 'Relatório técnico de inspeção e certificação de área',
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
        .text('ACC CERT', PAGE.left, 18, { width: 180 });
      document
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor('#d8eee2')
        .text('INSPEÇÃO E CERTIFICAÇÃO DE ÁREAS', PAGE.left, 39, { width: 240 });
      document
        .font('Helvetica-Bold')
        .fontSize(9)
        .fillColor(COLORS.white)
        .text(text(inspection.code, 'RELATÓRIO TÉCNICO'), 320, 25, {
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
          .text(`${sectionContinuation.toUpperCase()} - CONTINUAÇÃO`, PAGE.left, document.y, {
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
        .text(text(photo.caption, 'Evidência fotográfica sem legenda'), x + 9, y + 131, {
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
      const instruction = text(item.verificationInstruction, 'Não especificada');
      const comment = text(item.comment);
      const recommendation = text(item.recommendation);
      const descriptionHeight = labeledTextHeight(description, innerWidth);
      const instructionHeight = labeledTextHeight(instruction, innerWidth);
      const columnWidth = (innerWidth - 12) / 2;
      const commentHeight = labeledTextHeight(comment, columnWidth - 16);
      const recommendationHeight = labeledTextHeight(recommendation, columnWidth - 16);
      const notesHeight = Math.max(54, Math.max(commentHeight, recommendationHeight) + 30);
      const height = 42 + 25 + descriptionHeight + 24 + instructionHeight + 39 + notesHeight + 14;

      ensureSpace(Math.min(height, 620), 'Checklist de inspeção');
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
        .text('DESCRIÇÃO DO ITEM', PAGE.left + 12, cursor, { characterSpacing: 0.45 });
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
        .text('INSTRUÇÃO DE VERIFICAÇÃO', PAGE.left + 12, cursor, { characterSpacing: 0.45 });
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
        .text('COMENTÁRIO', PAGE.left + 20, cursor + 9, { characterSpacing: 0.45 });
      document
        .font('Helvetica')
        .fontSize(8.5)
        .fillColor(COLORS.ink)
        .text(comment, PAGE.left + 20, cursor + 23, { width: columnWidth - 16 });
      document
        .font('Helvetica-Bold')
        .fontSize(6.5)
        .fillColor(COLORS.muted)
        .text('RECOMENDAÇÃO', PAGE.left + 32 + columnWidth, cursor + 9, {
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
      .text('Relatório técnico de inspeção', PAGE.left, document.y, { width: PAGE.width });
    document.y += 32;

    const y1 = document.y;
    field(PAGE.left, y1, 331, 'Código da inspeção', inspection.code);
    field(
      PAGE.left + 340,
      y1,
      175,
      'Data da inspeção',
      formatInspectionDate(inspection.inspectionDate),
      {
        highlighted: true,
      },
    );
    const y2 = y1 + 58;
    field(
      PAGE.left,
      y2,
      253,
      'Projeto / obra',
      inspection.projectSnapshot?.name || inspection.projectId,
    );
    field(
      PAGE.left + 262,
      y2,
      253,
      'Checklist aplicado',
      inspection.checklistTemplateCode || inspection.checklistTemplateId,
    );
    const y3 = y2 + 58;
    field(
      PAGE.left,
      y3,
      PAGE.width,
      'Área inspecionada',
      `${text(inspection.areaSnapshot?.code || inspection.areaCode || inspection.areaId, '')} - ${text(inspection.areaSnapshot?.name || inspection.areaName, '')}`.replace(
        /^ - | - $/g,
        '',
      ),
    );
    const y4 = y3 + 58;
    field(PAGE.left, y4, 253, 'Localização / convés', inspection.areaLocation);
    field(PAGE.left + 262, y4, 253, 'Status do documento', 'Inspeção concluída');
    const y5 = y4 + 58;
    field(PAGE.left, y5, 253, 'Inspetor responsável', inspection.inspectorName);
    field(PAGE.left + 262, y5, 253, 'E-mail do inspetor', inspection.inspectorEmail);
    document.y = y5 + 65;

    sectionTitle('Resumo dos resultados', 'Consolidação dos itens registrados no checklist');
    const cardGap = 7;
    const cardWidth = (PAGE.width - cardGap * 4) / 5;
    const summaryY = document.y;
    summaryCard(
      PAGE.left,
      summaryY,
      cardWidth,
      Number(inspection.summary?.approved || 0),
      'Aprovados',
      COLORS.greenDark,
      COLORS.greenSoft,
    );
    summaryCard(
      PAGE.left + (cardWidth + cardGap),
      summaryY,
      cardWidth,
      Number(inspection.summary?.partiallyApproved || 0),
      'Parciais',
      COLORS.amber,
      COLORS.amberSoft,
    );
    summaryCard(
      PAGE.left + (cardWidth + cardGap) * 2,
      summaryY,
      cardWidth,
      Number(inspection.summary?.rejected || 0),
      'Reprovados',
      COLORS.red,
      COLORS.redSoft,
    );
    summaryCard(
      PAGE.left + (cardWidth + cardGap) * 3,
      summaryY,
      cardWidth,
      Number(inspection.summary?.notApplicable || 0),
      'Não aplicáveis',
      COLORS.blue,
      COLORS.blueSoft,
    );
    summaryCard(
      PAGE.left + (cardWidth + cardGap) * 4,
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
        'Evidências gerais da área',
        `${generalPhotos.length} fotografia(s) vinculada(s) à inspeção`,
      );
      photoRows(generalPhotos, 'Evidências gerais da área');
    }

    sectionTitle(
      'Checklist de inspeção',
      `${items.length} ${items.length === 1 ? 'item avaliado' : 'itens avaliados'} individualmente`,
    );
    for (const item of items) {
      itemDetails(item);
      const itemPhotos = photos.filter((photo) => photo.itemId === item.id);
      if (itemPhotos.length) {
        ensureSpace(26, 'Checklist de inspeção');
        document
          .font('Helvetica-Bold')
          .fontSize(7)
          .fillColor(COLORS.greenDark)
          .text(
            `EVIDÊNCIAS FOTOGRÁFICAS DO ITEM (${itemPhotos.length})`,
            PAGE.left + 5,
            document.y,
            {
              characterSpacing: 0.45,
            },
          );
        document.y += 17;
        photoRows(itemPhotos, `Evidências do item ${text(item.code, '')}`);
      }
      document.y += 4;
    }

    ensureSpace(76, 'Encerramento');
    const closingY = document.y + 4;
    document
      .roundedRect(PAGE.left, closingY, PAGE.width, 60, 5)
      .fillAndStroke(COLORS.panel, COLORS.line);
    document
      .font('Helvetica-Bold')
      .fontSize(7)
      .fillColor(COLORS.muted)
      .text('REGISTRO DO DOCUMENTO', PAGE.left + 12, closingY + 10, { characterSpacing: 0.5 });
    document
      .font('Helvetica')
      .fontSize(8)
      .fillColor(COLORS.ink)
      .text(
        `Gerado automaticamente pelo ACC Cert em ${formatGeneratedAt(generatedAt)}.`,
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
        'Este relatório consolida os dados e as evidências registrados eletronicamente na inspeção.',
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
        .text('ACC Cert - Relatório técnico de inspeção', PAGE.left, footerY, { width: 290 });
      document
        .font('Helvetica-Bold')
        .fontSize(7)
        .fillColor(COLORS.muted)
        .text(`Página ${page + 1} / ${range.count}`, 390, footerY, { width: 165, align: 'right' });
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

import { ZipArchive } from 'archiver';
import { randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { requireAdmin } from '../shared/auth.js';
import { adminDb, adminStorage } from '../shared/firebase.js';
import {
  buildPhotoArchivePath,
  csvText,
  sanitizeArchiveSegment,
  timestampToIso,
  type ExportCell,
} from './exportHelpers.js';

type DataRecord = FirebaseFirestore.DocumentData & { id: string };

interface InspectionExport {
  inspection: DataRecord;
  items: DataRecord[];
  photos: DataRecord[];
}

const INSPECTION_HEADERS = [
  'inspection_id',
  'inspection_code',
  'project_id',
  'area_id',
  'area_code',
  'area_name',
  'area_location',
  'checklist_code',
  'inspection_status',
  'inspection_date',
  'completed_at',
  'inspector_id',
  'inspector_name',
  'inspector_email',
  'summary_total',
  'summary_pending',
  'summary_approved',
  'summary_partially_approved',
  'summary_rejected',
  'summary_not_applicable',
  'general_photo_count',
  'general_photo_files',
  'item_id',
  'item_number',
  'item_code',
  'item_description',
  'verification_instruction',
  'item_status',
  'comment',
  'recommendation',
  'photo_required',
  'item_photo_count',
  'item_photo_files',
  'report_file',
  'report_storage_path',
];

const PHOTO_HEADERS = [
  'inspection_id',
  'inspection_code',
  'area_code',
  'item_id',
  'item_code',
  'category',
  'photo_id',
  'archive_path',
  'original_name',
  'caption',
  'created_by',
  'created_by_name',
  'created_at',
  'storage_path',
  'file_included',
];

async function loadInspectionExport(inspection: DataRecord): Promise<InspectionExport> {
  const inspectionRef = adminDb.doc(`inspections/${inspection.id}`);
  const [itemsSnapshot, photosSnapshot] = await Promise.all([
    inspectionRef.collection('items').orderBy('order').get(),
    inspectionRef.collection('photos').orderBy('order').get(),
  ]);
  return {
    inspection,
    items: itemsSnapshot.docs.map((item) => ({ id: item.id, ...item.data() })),
    photos: photosSnapshot.docs.map((photo) => ({ id: photo.id, ...photo.data() })),
  };
}

async function loadAllInspections() {
  const snapshots = await adminDb.collection('inspections').orderBy('inspectionDate', 'desc').get();
  const inspections = snapshots.docs.map(
    (inspection) => ({ id: inspection.id, ...inspection.data() }) as DataRecord,
  );
  const results: InspectionExport[] = [];
  for (let index = 0; index < inspections.length; index += 8) {
    results.push(
      ...(await Promise.all(inspections.slice(index, index + 8).map(loadInspectionExport))),
    );
  }
  return results;
}

export const exportDashboardPackage = onCall(
  {
    region: 'asia-east2',
    enforceAppCheck: false,
    memory: '1GiB',
    timeoutSeconds: 540,
  },
  async (request) => {
    const administrator = await requireAdmin(request);
    const exports = await loadAllInspections();
    if (exports.length === 0) {
      throw new HttpsError('failed-precondition', 'Não há inspeções para exportar.');
    }

    const bucket = adminStorage.bucket();
    const inspectionRows: Record<string, ExportCell>[] = [];
    const photoRows: Record<string, ExportCell>[] = [];
    const assets: Array<{ storagePath: string; archivePath: string }> = [];
    const missingFiles: string[] = [];

    for (const entry of exports) {
      const inspection = entry.inspection;
      const itemById = new Map(entry.items.map((item) => [item.id, item]));
      const photoPaths = new Map<string, string>();
      const photosByItem = new Map<string, string[]>();
      const generalPhotoPaths: string[] = [];

      for (const [photoIndex, photo] of entry.photos.entries()) {
        const item = photo.itemId ? itemById.get(String(photo.itemId)) : undefined;
        const archivePath = buildPhotoArchivePath({
          inspectionCode: String(inspection.code || inspection.id),
          itemCode: item?.code || (photo.itemId ? String(photo.itemId) : 'GERAIS'),
          photoId: photo.id,
          order: photoIndex + 1,
          storagePath: String(photo.storagePath || ''),
        });
        photoPaths.set(photo.id, archivePath);
        if (photo.itemId) {
          const itemPhotos = photosByItem.get(String(photo.itemId)) || [];
          itemPhotos.push(archivePath);
          photosByItem.set(String(photo.itemId), itemPhotos);
        } else {
          generalPhotoPaths.push(archivePath);
        }

        const storagePath = String(photo.storagePath || '');
        let included = false;
        if (storagePath) {
          const [exists] = await bucket.file(storagePath).exists();
          if (exists) {
            assets.push({ storagePath, archivePath });
            included = true;
          } else {
            missingFiles.push(storagePath);
          }
        }
        photoRows.push({
          inspection_id: inspection.id,
          inspection_code: inspection.code,
          area_code: inspection.areaCode,
          item_id: photo.itemId || '',
          item_code: item?.code || (photo.itemId ? String(photo.itemId) : 'GERAIS'),
          category: photo.itemId ? 'item' : 'general',
          photo_id: photo.id,
          archive_path: archivePath,
          original_name: photo.originalName,
          caption: photo.caption,
          created_by: photo.createdBy,
          created_by_name: photo.createdByName,
          created_at: timestampToIso(photo.createdAt),
          storage_path: storagePath,
          file_included: included,
        });
      }

      let reportArchivePath = '';
      const reportStoragePath = String(inspection.reportStoragePath || '');
      if (reportStoragePath) {
        const [exists] = await bucket.file(reportStoragePath).exists();
        if (exists) {
          reportArchivePath = `relatorios/${sanitizeArchiveSegment(
            inspection.code || inspection.id,
            'inspecao',
          )}.pdf`;
          assets.push({ storagePath: reportStoragePath, archivePath: reportArchivePath });
        } else {
          missingFiles.push(reportStoragePath);
        }
      }

      const baseRow: Record<string, ExportCell> = {
        inspection_id: inspection.id,
        inspection_code: inspection.code,
        project_id: inspection.projectId,
        area_id: inspection.areaId,
        area_code: inspection.areaCode,
        area_name: inspection.areaName,
        area_location: inspection.areaLocation,
        checklist_code: inspection.checklistTemplateCode,
        inspection_status: inspection.status,
        inspection_date: timestampToIso(inspection.inspectionDate),
        completed_at: timestampToIso(inspection.completedAt),
        inspector_id: inspection.inspectorId,
        inspector_name: inspection.inspectorName,
        inspector_email: inspection.inspectorEmail,
        summary_total: inspection.summary?.total || 0,
        summary_pending: inspection.summary?.notStarted || 0,
        summary_approved: inspection.summary?.approved || 0,
        summary_partially_approved: inspection.summary?.partiallyApproved || 0,
        summary_rejected: inspection.summary?.rejected || 0,
        summary_not_applicable: inspection.summary?.notApplicable || 0,
        general_photo_count: generalPhotoPaths.length,
        general_photo_files: generalPhotoPaths.join('|'),
        report_file: reportArchivePath,
        report_storage_path: reportStoragePath,
      };

      const exportItems = entry.items.length ? entry.items : [{ id: '' } as DataRecord];
      for (const item of exportItems) {
        const itemPhotos = photosByItem.get(item.id) || [];
        inspectionRows.push({
          ...baseRow,
          item_id: item.id,
          item_number: item.itemNumber,
          item_code: item.code,
          item_description: item.description,
          verification_instruction: item.verificationInstruction,
          item_status: item.status,
          comment: item.comment,
          recommendation: item.recommendation,
          photo_required: item.photoRequired,
          item_photo_count: itemPhotos.length,
          item_photo_files: itemPhotos.join('|'),
        });
      }
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const exportId = randomUUID();
    const storagePath = `adminExports/${administrator.uid}/acc-cert-dashboard-${timestamp}.zip`;
    const destination = bucket.file(storagePath);
    const output = destination.createWriteStream({
      resumable: false,
      metadata: {
        contentType: 'application/zip',
        cacheControl: 'private, max-age=0',
        metadata: { exportId, generatedBy: administrator.uid },
      },
    });
    const archive = new ZipArchive({ zlib: { level: 7 } });
    const completed = new Promise<void>((resolve, reject) => {
      output.on('finish', resolve);
      output.on('error', reject);
      archive.on('error', reject);
    });
    archive.pipe(output);
    archive.append(csvText(INSPECTION_HEADERS, inspectionRows), {
      name: 'dados/inspecoes_itens.csv',
    });
    archive.append(csvText(PHOTO_HEADERS, photoRows), { name: 'dados/manifesto_imagens.csv' });
    archive.append(
      [
        'ACC Cert - Pacote para dashboards',
        '',
        'dados/inspecoes_itens.csv: uma linha por item de checklist, com os dados da inspeção repetidos para facilitar o uso em Excel e Power BI.',
        'dados/manifesto_imagens.csv: relação entre cada fotografia, a inspeção, o item e o caminho no pacote.',
        'imagens/: fotografias organizadas por código da inspeção e código do item. Fotografias gerais ficam na pasta GERAIS.',
        'relatorios/: relatórios PDF disponíveis no momento da exportação.',
        '',
        'Datas estão em ISO 8601 (UTC) e os arquivos CSV usam UTF-8 com cabeçalho.',
      ].join('\r\n'),
      { name: 'LEIA-ME.txt' },
    );
    if (missingFiles.length) {
      archive.append(`${missingFiles.join('\r\n')}\r\n`, { name: 'dados/arquivos_ausentes.txt' });
    }
    for (const asset of assets) {
      archive.append(bucket.file(asset.storagePath).createReadStream(), {
        name: asset.archivePath,
      });
    }
    await archive.finalize();
    await completed;

    await adminDb.collection('auditLogs').add({
      userId: administrator.uid,
      action: 'dashboard.exported',
      entityType: 'adminExport',
      entityId: exportId,
      metadata: {
        storagePath,
        inspections: exports.length,
        rows: inspectionRows.length,
        photos: photoRows.length,
        reports: assets.filter((asset) => asset.archivePath.startsWith('relatorios/')).length,
        missingFiles: missingFiles.length,
      },
      createdAt: FieldValue.serverTimestamp(),
    });

    return {
      storagePath,
      fileName: `acc-cert-dashboard-${timestamp}.zip`,
      summary: {
        inspections: exports.length,
        rows: inspectionRows.length,
        photos: photoRows.length,
        reports: assets.filter((asset) => asset.archivePath.startsWith('relatorios/')).length,
      },
    };
  },
);

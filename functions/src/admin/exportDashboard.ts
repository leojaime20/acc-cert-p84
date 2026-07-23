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
  'inspection_type',
  'source_inspection_id',
  'source_inspection_code',
  'inspection_date',
  'completed_at',
  'inspector_id',
  'inspector_name',
  'inspector_email',
  'summary_total',
  'summary_pending',
  'summary_ok',
  'summary_punch_list',
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

function exportedItemStatus(status: unknown): string {
  if (status === 'approved') return 'ok';
  if (status === 'rejected' || status === 'partially_approved') return 'punch_list';
  return typeof status === 'string' ? status : '';
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
      throw new HttpsError('failed-precondition', 'There are no inspections to export.');
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
          itemCode: item?.code || (photo.itemId ? String(photo.itemId) : 'GENERAL'),
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
          item_code: item?.code || (photo.itemId ? String(photo.itemId) : 'GENERAL'),
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
          reportArchivePath = `reports/${sanitizeArchiveSegment(
            inspection.code || inspection.id,
            'inspection',
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
        inspection_type: inspection.inspectionType || 'initial',
        source_inspection_id: inspection.sourceInspectionId,
        source_inspection_code: inspection.sourceInspectionCode,
        inspection_date: timestampToIso(inspection.inspectionDate),
        completed_at: timestampToIso(inspection.completedAt),
        inspector_id: inspection.inspectorId,
        inspector_name: inspection.inspectorName,
        inspector_email: inspection.inspectorEmail,
        summary_total: inspection.summary?.total || 0,
        summary_pending: inspection.summary?.notStarted || 0,
        summary_ok: inspection.summary?.ok ?? inspection.summary?.approved ?? 0,
        summary_punch_list:
          inspection.summary?.punchList ??
          Number(inspection.summary?.rejected || 0) +
            Number(inspection.summary?.partiallyApproved || 0),
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
          item_status: exportedItemStatus(item.status),
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
      name: 'data/inspection_items.csv',
    });
    archive.append(csvText(PHOTO_HEADERS, photoRows), { name: 'data/image_manifest.csv' });
    archive.append(
      [
        'AC Certificate - Dashboard package',
        '',
        'data/inspection_items.csv: one row per checklist item, repeating inspection fields to support Excel and Power BI.',
        'data/image_manifest.csv: links each photo to its inspection, item and package path.',
        'images/: photos organized by inspection and item code. General photos are in the GENERAL folder.',
        'reports/: PDF reports available when the export was generated.',
        '',
        'Dates use ISO 8601 (UTC), and CSV files use UTF-8 with headers.',
      ].join('\r\n'),
      { name: 'README.txt' },
    );
    if (missingFiles.length) {
      archive.append(`${missingFiles.join('\r\n')}\r\n`, { name: 'data/missing_files.txt' });
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
        reports: assets.filter((asset) => asset.archivePath.startsWith('reports/')).length,
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
        reports: assets.filter((asset) => asset.archivePath.startsWith('reports/')).length,
      },
    };
  },
);

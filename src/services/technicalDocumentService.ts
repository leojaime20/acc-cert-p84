import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  deleteObject,
  getBytes,
  getDownloadURL,
  ref,
  uploadBytesResumable,
  type UploadTask,
} from 'firebase/storage';
import { db } from '../lib/firebase/firestore';
import { storage } from '../lib/firebase/storage';
import type {
  TechnicalDocument,
  TechnicalDocumentCategory,
  TechnicalDocumentVersion,
} from '../types/technicalDocument';
import type { UserProfile } from '../types/user';

export const MAX_TECHNICAL_DOCUMENT_SIZE = 50 * 1024 * 1024;

export interface TechnicalDocumentInput {
  projectId: string;
  areaIds: string[];
  appliesToAllAreas: boolean;
  title: string;
  description: string;
  category: TechnicalDocumentCategory;
  version: string;
  issueDate?: string;
  active: boolean;
  allowDownload: boolean;
}

export interface TechnicalDocumentUploadHandle {
  promise: Promise<TechnicalDocument>;
  cancel: () => void;
}

export class TechnicalDocumentError extends Error {
  readonly code: string;

  constructor(message: string, code: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'TechnicalDocumentError';
    this.code = code;
  }
}

function requireFirebase() {
  if (!db || !storage) throw new TechnicalDocumentError('Firebase is not configured.', 'firebase');
  return { db, storage };
}

function normalizeFileName(fileName: string) {
  return fileName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

export async function validateTechnicalDocumentFile(file: File) {
  if (!file.name.toLocaleLowerCase('en').endsWith('.pdf')) {
    throw new TechnicalDocumentError('Select a file with a PDF extension.', 'extension');
  }
  if (file.type && file.type !== 'application/pdf') {
    throw new TechnicalDocumentError('The selected file is not a PDF.', 'mime-type');
  }
  if (file.size <= 0) {
    throw new TechnicalDocumentError('The selected file is empty.', 'empty');
  }
  if (file.size > MAX_TECHNICAL_DOCUMENT_SIZE) {
    throw new TechnicalDocumentError('The PDF must be no larger than 50 MB.', 'too-large');
  }

  const signature = new TextDecoder('ascii').decode(await file.slice(0, 5).arrayBuffer());
  if (signature !== '%PDF-') {
    throw new TechnicalDocumentError('The file contents do not match a valid PDF.', 'signature');
  }
}

export async function listTechnicalDocuments(projectId: string, includeInactive = false) {
  const firebase = requireFirebase();
  const constraints = includeInactive
    ? [where('projectId', '==', projectId)]
    : [
        where('projectId', '==', projectId),
        where('active', '==', true),
        where('status', '==', 'ready'),
      ];
  const snapshot = await getDocs(
    query(collection(firebase.db, 'technicalDocuments'), ...constraints),
  );
  return snapshot.docs
    .map((item) => ({ id: item.id, ...item.data() }) as TechnicalDocument)
    .sort((a, b) => a.title.localeCompare(b.title, 'en'));
}

export async function listTechnicalDocumentsForArea(projectId: string, areaId: string) {
  const documents = await listTechnicalDocuments(projectId);
  return documents.filter(
    (document) => document.appliesToAllAreas || document.areaIds.includes(areaId),
  );
}

export async function getTechnicalDocument(documentId: string) {
  const firebase = requireFirebase();
  const snapshot = await getDoc(doc(firebase.db, 'technicalDocuments', documentId));
  if (!snapshot.exists()) {
    throw new TechnicalDocumentError('Document not found.', 'not-found');
  }
  return { id: snapshot.id, ...snapshot.data() } as TechnicalDocument;
}

export async function getTechnicalDocumentUrl(document: TechnicalDocument) {
  const firebase = requireFirebase();
  return getDownloadURL(ref(firebase.storage, document.storagePath));
}

export async function getTechnicalDocumentBytes(document: TechnicalDocument) {
  const firebase = requireFirebase();
  return getBytes(ref(firebase.storage, document.storagePath), MAX_TECHNICAL_DOCUMENT_SIZE);
}

export async function listTechnicalDocumentVersions(documentId: string) {
  const firebase = requireFirebase();
  const snapshot = await getDocs(
    collection(firebase.db, 'technicalDocuments', documentId, 'versions'),
  );
  return snapshot.docs
    .map((item) => ({ id: item.id, ...item.data() }) as TechnicalDocumentVersion)
    .sort((a, b) => (b.uploadedAt?.toMillis?.() || 0) - (a.uploadedAt?.toMillis?.() || 0));
}

export function uploadTechnicalDocument(
  input: TechnicalDocumentInput,
  file: File,
  user: UserProfile,
  onProgress: (progress: number) => void,
  existingDocument?: TechnicalDocument,
): TechnicalDocumentUploadHandle {
  const firebase = requireFirebase();
  let uploadTask: UploadTask | undefined;
  let cancelled = false;

  const promise = (async () => {
    await validateTechnicalDocumentFile(file);
    if (!input.appliesToAllAreas && input.areaIds.length === 0) {
      throw new TechnicalDocumentError('Select at least one area.', 'area-required');
    }
    if (existingDocument && existingDocument.projectId !== input.projectId) {
      throw new TechnicalDocumentError(
        'The new version must remain in the same project.',
        'project',
      );
    }

    const documentReference = existingDocument
      ? doc(firebase.db, 'technicalDocuments', existingDocument.id)
      : doc(collection(firebase.db, 'technicalDocuments'));
    const versionReference = doc(collection(documentReference, 'versions'));
    const safeName = normalizeFileName(file.name) || 'document.pdf';
    const storagePath = `projects/${input.projectId}/technicalDocuments/${documentReference.id}/versions/${versionReference.id}-${safeName}`;

    const currentDocumentData = {
      projectId: input.projectId,
      areaIds: input.appliesToAllAreas ? [] : input.areaIds,
      appliesToAllAreas: input.appliesToAllAreas,
      title: input.title.trim(),
      description: input.description.trim(),
      category: input.category,
      version: input.version.trim(),
      issueDate: input.issueDate || '',
      fileName: file.name,
      storagePath,
      contentType: 'application/pdf' as const,
      size: file.size,
      active: input.active,
      currentVersionId: versionReference.id,
      allowDownload: input.allowDownload,
      uploadedBy: user.uid,
      uploadedByName: user.name,
      uploadedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    if (!existingDocument) {
      await setDoc(documentReference, {
        ...currentDocumentData,
        status: 'uploading',
        createdAt: serverTimestamp(),
      });
    }

    const storageReference = ref(firebase.storage, storagePath);
    uploadTask = uploadBytesResumable(storageReference, file, {
      contentType: 'application/pdf',
      customMetadata: {
        projectId: input.projectId,
        documentId: documentReference.id,
        versionId: versionReference.id,
      },
    });

    try {
      await new Promise<void>((resolve, reject) => {
        uploadTask?.on(
          'state_changed',
          (snapshot) =>
            onProgress(
              snapshot.totalBytes > 0
                ? Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)
                : 0,
            ),
          reject,
          resolve,
        );
      });
    } catch (error) {
      if (!existingDocument) {
        await updateDoc(documentReference, { status: 'failed', updatedAt: serverTimestamp() });
      }
      throw new TechnicalDocumentError(
        cancelled ? 'The upload was cancelled.' : 'PDF upload failed. Try again.',
        cancelled ? 'cancelled' : 'upload',
        { cause: error },
      );
    }

    const versionData = {
      version: input.version.trim(),
      issueDate: input.issueDate || '',
      fileName: file.name,
      storagePath,
      contentType: 'application/pdf' as const,
      size: file.size,
      uploadedBy: user.uid,
      uploadedByName: user.name,
      uploadedAt: serverTimestamp(),
    };
    const batch = writeBatch(firebase.db);
    batch.set(versionReference, versionData);
    batch.update(documentReference, { ...currentDocumentData, status: 'ready' });
    await batch.commit();

    const snapshot = await getDoc(documentReference);
    return { id: snapshot.id, ...snapshot.data() } as TechnicalDocument;
  })();

  return {
    promise,
    cancel() {
      cancelled = true;
      uploadTask?.cancel();
    },
  };
}

export async function setTechnicalDocumentActive(documentId: string, active: boolean) {
  const firebase = requireFirebase();
  await updateDoc(doc(firebase.db, 'technicalDocuments', documentId), {
    active,
    updatedAt: serverTimestamp(),
  });
}

export async function removeFailedTechnicalDocumentFile(document: TechnicalDocument) {
  const firebase = requireFirebase();
  if (!document.storagePath) return;
  try {
    await deleteObject(ref(firebase.storage, document.storagePath));
  } catch {
    // An interrupted upload may not have created the object.
  }
}

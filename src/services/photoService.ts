import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage';
import { db } from '../lib/firebase/firestore';
import { storage } from '../lib/firebase/storage';
import type { InspectionPhoto, PhotoUploadStage } from '../types/inspection';
import type { UserProfile } from '../types/user';

const MAX_SOURCE_SIZE = 25 * 1024 * 1024;
const MAX_UPLOAD_SIZE = 2 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export class PhotoUploadError extends Error {
  readonly stage: PhotoUploadStage;
  readonly code: string;
  readonly photoId?: string;

  constructor(
    message: string,
    options: {
      stage: PhotoUploadStage;
      code?: string;
      photoId?: string;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options.cause });
    this.name = 'PhotoUploadError';
    this.stage = options.stage;
    this.code = options.code || 'unknown';
    this.photoId = options.photoId;
  }
}

function requireFirebase() {
  if (!db || !storage) throw new Error('Firebase não configurado.');
  return { db, storage };
}

function errorCode(error: unknown) {
  if (typeof error === 'object' && error && 'code' in error) {
    return String((error as { code: unknown }).code);
  }
  return 'unknown';
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Erro desconhecido.';
}

export function validatePhotoFile(file: File) {
  if (!SUPPORTED_IMAGE_TYPES.has(file.type.toLowerCase())) {
    const isHeic = ['image/heic', 'image/heif'].includes(file.type.toLowerCase());
    throw new PhotoUploadError(
      isHeic
        ? 'O formato HEIC/HEIF ainda não é compatível. No iPhone, escolha “Mais compatível” nas configurações da câmera ou envie JPEG, PNG ou WebP.'
        : 'Formato não compatível. Envie uma imagem JPEG, PNG ou WebP.',
      { stage: 'validation', code: 'unsupported-image-type' },
    );
  }
  if (file.size <= 0) {
    throw new PhotoUploadError('A fotografia selecionada está vazia.', {
      stage: 'validation',
      code: 'empty-file',
    });
  }
  if (file.size > MAX_SOURCE_SIZE) {
    throw new PhotoUploadError('A fotografia original deve ter no máximo 25 MB.', {
      stage: 'validation',
      code: 'source-too-large',
    });
  }
}

async function dimensionsWithImageElement(file: Blob) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const dimensions = { width: image.naturalWidth, height: image.naturalHeight };
      URL.revokeObjectURL(objectUrl);
      resolve(dimensions);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('O navegador não conseguiu ler as dimensões da imagem.'));
    };
    image.src = objectUrl;
  });
}

export async function readImageDimensions(file: Blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      const dimensions = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return dimensions;
    } catch {
      // Safari/iOS pode expor createImageBitmap sem aceitar todos os formatos decodificáveis.
    }
  }
  return dimensionsWithImageElement(file);
}

async function compressPhoto(sourceFile: File) {
  const { default: imageCompression } = await import('browser-image-compression');
  const compressed = await imageCompression(sourceFile, {
    maxSizeMB: 1.7,
    maxWidthOrHeight: 1920,
    // Evita depender de um worker carregado por CDN, que pode ser bloqueado em campo.
    useWebWorker: false,
    fileType: 'image/jpeg',
    initialQuality: 0.9,
  });

  if (compressed.size <= 0 || compressed.size > MAX_UPLOAD_SIZE) {
    throw new PhotoUploadError('Não foi possível reduzir a fotografia para o limite de 2 MB.', {
      stage: 'compression',
      code: 'compressed-size-invalid',
    });
  }
  return compressed;
}

export async function uploadInspectionPhoto(
  inspectionId: string,
  itemId: string | null,
  sourceFile: File,
  caption: string,
  user: UserProfile,
  onProgress: (progress: number) => void,
  existingPhotoId?: string,
) {
  const firebase = requireFirebase();
  let stage: PhotoUploadStage = 'validation';
  let photoId = existingPhotoId;
  let photoReference: ReturnType<typeof doc> | undefined;
  let pendingWritten = false;

  try {
    validatePhotoFile(sourceFile);

    stage = 'compression';
    const compressed = await compressPhoto(sourceFile);

    stage = 'dimensions';
    const dimensions = await readImageDimensions(compressed);

    stage = 'firestore-pending';
    photoReference = photoId
      ? doc(firebase.db, 'inspections', inspectionId, 'photos', photoId)
      : doc(collection(firebase.db, 'inspections', inspectionId, 'photos'));
    photoId = photoReference.id;
    const storagePath = itemId
      ? `inspections/${inspectionId}/items/${itemId}/${photoId}.jpg`
      : `inspections/${inspectionId}/general/${photoId}.jpg`;
    const order = Date.now();

    await setDoc(
      photoReference,
      {
        itemId,
        category: itemId ? 'item' : 'general',
        storagePath,
        originalName: sourceFile.name,
        mimeType: 'image/jpeg',
        size: compressed.size,
        ...dimensions,
        caption: caption.trim(),
        order,
        uploadStatus: 'pending',
        createdBy: user.uid,
        createdByName: user.name,
        ...(existingPhotoId ? {} : { createdAt: serverTimestamp() }),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    pendingWritten = true;

    const storageRef = ref(firebase.storage, storagePath);
    stage = 'storage-upload';
    const upload = uploadBytesResumable(storageRef, compressed, { contentType: 'image/jpeg' });
    await new Promise<void>((resolve, reject) => {
      upload.on(
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

    stage = 'download-url';
    const downloadUrl = await getDownloadURL(storageRef);

    stage = 'firestore-complete';
    await updateDoc(photoReference, {
      uploadStatus: 'completed',
      errorStage: deleteField(),
      errorCode: deleteField(),
      errorMessage: deleteField(),
      updatedAt: serverTimestamp(),
    });

    return {
      id: photoId,
      itemId,
      category: itemId ? 'item' : 'general',
      storagePath,
      downloadUrl,
      originalName: sourceFile.name,
      mimeType: 'image/jpeg',
      size: compressed.size,
      ...dimensions,
      caption: caption.trim(),
      order,
      uploadStatus: 'completed',
      createdBy: user.uid,
      createdByName: user.name,
    } as InspectionPhoto;
  } catch (error) {
    const normalized =
      error instanceof PhotoUploadError
        ? error
        : new PhotoUploadError(errorMessage(error), {
            stage,
            code: errorCode(error),
            photoId,
            cause: error,
          });

    if (photoReference && pendingWritten) {
      await setDoc(
        photoReference,
        {
          uploadStatus: 'failed',
          errorStage: normalized.stage,
          errorCode: normalized.code,
          errorMessage: normalized.message.slice(0, 500),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      ).catch(() => undefined);
    }

    if (normalized.photoId || !photoId) throw normalized;
    throw new PhotoUploadError(normalized.message, {
      stage: normalized.stage,
      code: normalized.code,
      photoId,
      cause: normalized,
    });
  }
}

export async function listInspectionPhotos(inspectionId: string) {
  const firebase = requireFirebase();
  const snapshot = await getDocs(
    query(collection(firebase.db, 'inspections', inspectionId, 'photos'), orderBy('order')),
  );

  return Promise.all(
    snapshot.docs.map(async (photo) => {
      const data = photo.data() as Omit<InspectionPhoto, 'id' | 'downloadUrl'>;
      const result = { id: photo.id, ...data } as InspectionPhoto;
      if (data.uploadStatus !== 'completed') return result;

      try {
        result.downloadUrl = await getDownloadURL(ref(firebase.storage, data.storagePath));
      } catch (error) {
        result.loadError = errorCode(error);
      }
      return result;
    }),
  );
}

export async function removeInspectionPhoto(inspectionId: string, photo: InspectionPhoto) {
  return discardInspectionPhotoAttempt(inspectionId, photo.itemId, photo.id);
}

export async function discardInspectionPhotoAttempt(
  inspectionId: string,
  itemId: string | null,
  photoId: string,
) {
  const firebase = requireFirebase();
  const storagePath = itemId
    ? `inspections/${inspectionId}/items/${itemId}/${photoId}.jpg`
    : `inspections/${inspectionId}/general/${photoId}.jpg`;
  try {
    await deleteObject(ref(firebase.storage, storagePath));
  } catch (error) {
    if (errorCode(error) !== 'storage/object-not-found') throw error;
  }
  await deleteDoc(doc(firebase.db, 'inspections', inspectionId, 'photos', photoId));
}

export async function getStorageDownloadUrl(storagePath: string) {
  const firebase = requireFirebase();
  return getDownloadURL(ref(firebase.storage, storagePath));
}

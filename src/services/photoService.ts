import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
} from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage';
import { db } from '../lib/firebase/firestore';
import { storage } from '../lib/firebase/storage';
import type { InspectionPhoto } from '../types/inspection';
import type { UserProfile } from '../types/user';

function requireFirebase() {
  if (!db || !storage) throw new Error('Firebase não configurado.');
  return { db, storage };
}

async function imageDimensions(file: Blob) {
  const bitmap = await createImageBitmap(file);
  const dimensions = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return dimensions;
}

export async function uploadInspectionPhoto(
  inspectionId: string,
  itemId: string | null,
  sourceFile: File,
  caption: string,
  user: UserProfile,
  onProgress: (progress: number) => void,
) {
  const firebase = requireFirebase();
  const { default: imageCompression } = await import('browser-image-compression');
  const compressed = await imageCompression(sourceFile, {
    maxSizeMB: 1.7,
    maxWidthOrHeight: 1920,
    useWebWorker: true,
    fileType: 'image/jpeg',
  });
  const dimensions = await imageDimensions(compressed);
  const photoId = crypto.randomUUID();
  const storagePath = itemId
    ? `inspections/${inspectionId}/items/${itemId}/${photoId}.jpg`
    : `inspections/${inspectionId}/general/${photoId}.jpg`;
  const storageRef = ref(firebase.storage, storagePath);
  const upload = uploadBytesResumable(storageRef, compressed, { contentType: 'image/jpeg' });

  await new Promise<void>((resolve, reject) => {
    upload.on(
      'state_changed',
      (snapshot) => onProgress(Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)),
      reject,
      resolve,
    );
  });

  try {
    const downloadUrl = await getDownloadURL(storageRef);
    const order = Date.now();
    const photoRef = await addDoc(collection(firebase.db, 'inspections', inspectionId, 'photos'), {
      itemId,
      category: itemId ? 'item' : 'general',
      storagePath,
      originalName: sourceFile.name,
      mimeType: 'image/jpeg',
      size: compressed.size,
      ...dimensions,
      caption: caption.trim(),
      order,
      uploadStatus: 'completed',
      createdBy: user.uid,
      createdByName: user.name,
      createdAt: serverTimestamp(),
    });
    return {
      id: photoRef.id,
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
    await deleteObject(storageRef).catch(() => undefined);
    throw error;
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
      return {
        id: photo.id,
        ...data,
        downloadUrl: await getDownloadURL(ref(firebase.storage, data.storagePath)),
      } as InspectionPhoto;
    }),
  );
}

export async function removeInspectionPhoto(inspectionId: string, photo: InspectionPhoto) {
  const firebase = requireFirebase();
  await deleteObject(ref(firebase.storage, photo.storagePath));
  await deleteDoc(doc(firebase.db, 'inspections', inspectionId, 'photos', photo.id));
}

export async function getStorageDownloadUrl(storagePath: string) {
  const firebase = requireFirebase();
  return getDownloadURL(ref(firebase.storage, storagePath));
}

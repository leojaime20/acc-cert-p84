import { getStorage, type FirebaseStorage } from 'firebase/storage';
import { firebaseApp } from './app';

export const storage: FirebaseStorage | null = firebaseApp ? getStorage(firebaseApp) : null;

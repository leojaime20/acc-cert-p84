import { getFirestore, type Firestore } from 'firebase/firestore';
import { firebaseApp } from './app';

export const db: Firestore | null = firebaseApp ? getFirestore(firebaseApp) : null;

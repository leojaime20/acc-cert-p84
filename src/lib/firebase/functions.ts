import { getFunctions, type Functions } from 'firebase/functions';
import { firebaseApp } from './app';

export const functions: Functions | null = firebaseApp
  ? getFunctions(firebaseApp, import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION || 'asia-east2')
  : null;

import { getAuth, type Auth } from 'firebase/auth';
import { firebaseApp } from './app';

export const auth: Auth | null = firebaseApp ? getAuth(firebaseApp) : null;

import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT;
const email = process.env.INITIAL_ADMIN_EMAIL;
const name = process.env.INITIAL_ADMIN_NAME;
const password = process.env.INITIAL_ADMIN_PASSWORD;

if (!projectId || !email || !name || !password) {
  throw new Error(
    'Defina FIREBASE_PROJECT_ID, INITIAL_ADMIN_EMAIL, INITIAL_ADMIN_NAME e INITIAL_ADMIN_PASSWORD.',
  );
}
if (password.length < 12) throw new Error('A senha inicial deve possuir pelo menos 12 caracteres.');

if (getApps().length === 0) initializeApp({ credential: applicationDefault(), projectId });
const auth = getAuth();
const db = getFirestore();

let user;
try {
  user = await auth.getUserByEmail(email);
} catch {
  user = await auth.createUser({ email, displayName: name, password, emailVerified: false });
}

await db.doc(`users/${user.uid}`).set(
  {
    uid: user.uid,
    name,
    email,
    role: 'admin',
    active: true,
    projectIds: ['p84'],
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  },
  { merge: true },
);

console.log(`Administrador configurado: ${email}`);

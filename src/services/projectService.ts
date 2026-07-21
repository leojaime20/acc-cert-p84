import {
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { db } from '../lib/firebase/firestore';
import type { Area, Project } from '../types/project';

function requireDb() {
  if (!db) throw new Error('Firebase is not configured.');
  return db;
}

export async function listProjects(projectIds: string[], isAdmin: boolean) {
  const projectsRef = collection(requireDb(), 'projects');
  const constraints = isAdmin
    ? [orderBy('name')]
    : [where(documentId(), 'in', projectIds.slice(0, 30))];

  if (!isAdmin && projectIds.length === 0) return [];
  const snapshot = await getDocs(query(projectsRef, ...constraints));
  return snapshot.docs
    .map((item) => ({ id: item.id, ...item.data() }) as Project)
    .filter((project) => project.active);
}

export async function listAreas(projectId: string) {
  const areasRef = collection(requireDb(), 'projects', projectId, 'areas');
  const snapshot = await getDocs(query(areasRef, where('active', '==', true), orderBy('order')));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Area);
}

export async function getArea(projectId: string, areaId: string) {
  const snapshot = await getDoc(doc(requireDb(), 'projects', projectId, 'areas', areaId));
  if (!snapshot.exists()) throw new Error('Area not found.');
  return { id: snapshot.id, ...snapshot.data() } as Area;
}

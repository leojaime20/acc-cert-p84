import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { auth } from '../../lib/firebase/auth';
import { db } from '../../lib/firebase/firestore';
import type { UserProfile } from '../../types/user';
import { AuthContext, type AuthContextValue } from './authContext';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(Boolean(auth));

  useEffect(() => {
    if (!auth || !db) return;
    const firebaseAuth = auth;
    const firestore = db;
    return onAuthStateChanged(firebaseAuth, async (nextUser) => {
      setUser(nextUser);
      setProfile(null);
      if (nextUser) {
        const snapshot = await getDoc(doc(firestore, 'users', nextUser.uid));
        if (snapshot.exists()) setProfile(snapshot.data() as UserProfile);
      }
      setLoading(false);
    });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      profile,
      loading,
      async login(email, password) {
        if (!auth) throw new Error('Firebase não configurado.');
        await signInWithEmailAndPassword(auth, email, password);
      },
      async logout() {
        if (auth) await firebaseSignOut(auth);
      },
    }),
    [loading, profile, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

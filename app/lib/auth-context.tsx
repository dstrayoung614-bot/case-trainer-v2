'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import {
  User,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from './firebase';

export type UserRole = 'student' | 'admin';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  createdAt: unknown;
}

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  signUp: (email: string, password: string, displayName: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  logOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  async function createSession(user: User) {
    try {
      const idToken = await user.getIdToken();
      await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });
    } catch {
      // session cookie — best effort, не блокируем UI
    }
  }

  useEffect(() => {
    if (!auth) { setLoading(false); return; }
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser && db) {
        // Восстанавливаем session cookie при каждой загрузке страницы
        // чтобы /api/admin/users и другие серверные роуты работали
        createSession(firebaseUser);
        const snap = await getDoc(doc(db, 'users', firebaseUser.uid));
        setProfile(snap.exists() ? (snap.data() as UserProfile) : null);
      } else {
        setProfile(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function signUp(email: string, password: string, displayName: string) {
    if (!auth || !db) throw new Error('Firebase не инициализирован');
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    const newProfile: UserProfile = {
      uid: cred.user.uid,
      email,
      displayName: displayName.trim() || email.split('@')[0],
      role: 'student',
      createdAt: serverTimestamp(),
    };
    await setDoc(doc(db, 'users', cred.user.uid), newProfile);
    setProfile(newProfile);
    await createSession(cred.user);
  }

  async function signIn(email: string, password: string) {
    if (!auth) throw new Error('Firebase не инициализирован');
    const cred = await signInWithEmailAndPassword(auth, email, password);
    await createSession(cred.user);
  }

  async function logOut() {
    if (!auth) return;
    await fetch('/api/auth/session', { method: 'DELETE' });
    await signOut(auth);
    setProfile(null);
  }

  return (
    <AuthContext.Provider value={{ user, profile, loading, signUp, signIn, logOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey:            process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain:        process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId:         process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket:     process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId:             process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Lazy-инициализация — безопасна при SSR/сборке без env vars
function getClientApp(): FirebaseApp | null {
  if (!firebaseConfig.apiKey || !firebaseConfig.projectId) return null;
  return getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
}

function getClientAuth(): Auth | null {
  const app = getClientApp();
  return app ? getAuth(app) : null;
}

function getClientDb(): Firestore | null {
  const app = getClientApp();
  return app ? getFirestore(app) : null;
}

// auth и db — null в среде сборки без env vars, живые объекты в браузере
export const auth = getClientAuth();
export const db   = getClientDb();
export default getClientApp();

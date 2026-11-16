import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import { getAuth, connectAuthEmulator, type Auth } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, type Firestore } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator, httpsCallable, type Functions } from 'firebase/functions';
import { getStorage, connectStorageEmulator, type FirebaseStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'demo-bharat-makaan-api-key',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'bharat-makaan-prod.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'bharat-makaan-prod',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'bharat-makaan-prod.appspot.com',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '000000000000',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:000000000000:web:bharatmakaan',
};

export const isFirebaseConfigured = Boolean(
  import.meta.env.VITE_FIREBASE_API_KEY && import.meta.env.VITE_FIREBASE_PROJECT_ID
);

export const isEmulatorMode = import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true';

let appInstance: FirebaseApp;
if (getApps().length === 0) {
  appInstance = initializeApp(firebaseConfig);
} else {
  appInstance = getApps()[0]!;
}

export const firebaseApp: FirebaseApp = appInstance;

// Enable Firebase App Check automatically in browser when reCAPTCHA v3 site key is configured
if (
  typeof window !== 'undefined' &&
  import.meta.env.VITE_FIREBASE_APP_CHECK_SITE_KEY &&
  !isEmulatorMode
) {
  try {
    initializeAppCheck(firebaseApp, {
      provider: new ReCaptchaV3Provider(
        String(import.meta.env.VITE_FIREBASE_APP_CHECK_SITE_KEY)
      ),
      isTokenAutoRefreshEnabled: true,
    });
  } catch {
    // Prevent duplicate App Check init in HMR
  }
}

export const auth: Auth = getAuth(firebaseApp);
export const db: Firestore = getFirestore(firebaseApp);
export const functions: Functions = getFunctions(firebaseApp);
export const storage: FirebaseStorage = getStorage(firebaseApp);

let emulatorsConnected = false;
if (isEmulatorMode && !emulatorsConnected) {
  emulatorsConnected = true;
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
  connectStorageEmulator(storage, '127.0.0.1', 9199);
}

/**
 * Typed wrapper around Firebase Cloud Functions v2 `httpsCallable`.
 */
export async function callBackendFunction<TReq, TRes>(
  functionName: string,
  payload: TReq
): Promise<TRes> {
  const callable = httpsCallable<TReq, TRes>(functions, functionName);
  const response = await callable(payload);
  return response.data;
}

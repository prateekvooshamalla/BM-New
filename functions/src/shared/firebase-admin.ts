import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

if (getApps().length === 0) {
  initializeApp();
}

export const adminDb = getFirestore();
// Optional domain fields should be omitted from documents when left blank.
// Configure before the first query/transaction so all backend writes agree.
adminDb.settings({ ignoreUndefinedProperties: true });
export const adminAuth = getAuth();
export const adminStorage = getStorage();

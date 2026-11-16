import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Notifications from 'expo-notifications';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getStorage, ref as storageRef, uploadBytes } from 'firebase/storage';

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY || 'demo-bharat-makaan-mobile',
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN || 'bharat-makaan-prod.firebaseapp.com',
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || 'bharat-makaan-prod',
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || 'bharat-makaan-prod.appspot.com',
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '000000000000',
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID || '1:000000000000:ios:bharatmakaan',
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0]!;

export const mobileAuth = getAuth(app);
export const mobileDb = getFirestore(app);
export const mobileFunctions = getFunctions(app);
export const mobileStorage = getStorage(app);

const SECURE_SESSION_KEY = 'bm_enterprise_active_org_v1';

export async function saveSecureActiveOrgId(orgId: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(SECURE_SESSION_KEY, orgId);
  } catch {
    // Fallback on simulator environments without Secure Enclave
  }
}

export async function readSecureActiveOrgId(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(SECURE_SESSION_KEY);
  } catch {
    return null;
  }
}

export async function clearSecureSession(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(SECURE_SESSION_KEY);
  } catch {
    // Ignore
  }
}

export async function callMobileBackend<TReq, TRes>(
  fnName: string,
  payload: TReq
): Promise<TRes> {
  const fn = httpsCallable<TReq, TRes>(mobileFunctions, fnName);
  const res = await fn(payload);
  return res.data;
}

export async function registerDeviceForPushNotifications(orgId: string): Promise<string | null> {
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') return null;

  const tokenData = await Notifications.getExpoPushTokenAsync();
  await callMobileBackend('registerMobilePushToken', {
    orgId,
    fcmOrExpoToken: tokenData.data,
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
  });
  return tokenData.data;
}

export async function pickAndUploadSitePhoto(orgId: string, projectId: string | null) {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error('Photo library permission denied.');

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.85,
  });

  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  const fileName = asset.fileName || `site_photo_${Date.now()}.jpg`;
  const resp = await fetch(asset.uri);
  const blob = await resp.blob();
  const path = `organizations/${orgId}/projects/${projectId ?? 'general'}/media/${Date.now()}_${fileName}`;
  await uploadBytes(storageRef(mobileStorage, path), blob, {
    contentType: asset.mimeType || 'image/jpeg',
  });

  return callMobileBackend('registerDocument', {
    orgId,
    projectId,
    category: 'BROCHURE',
    title: fileName,
    fileName,
    mimeType: 'image/jpeg',
    sizeBytes: asset.fileSize || blob.size || 1024,
    storagePath: path,
    visibility: 'INTERNAL',
    watermarkEnabled: false,
  });
}

export async function pickAndUploadFloorPlanPdf(orgId: string, projectId: string | null) {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/pdf', 'image/png', 'image/jpeg'],
    copyToCacheDirectory: true,
  });
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  const resp = await fetch(asset.uri);
  const blob = await resp.blob();
  const path = `organizations/${orgId}/projects/${projectId ?? 'general'}/documents/${Date.now()}_${asset.name}`;
  await uploadBytes(storageRef(mobileStorage, path), blob, {
    contentType: asset.mimeType || 'application/pdf',
  });

  return callMobileBackend('registerDocument', {
    orgId,
    projectId,
    category: 'FLOOR_PLAN',
    title: asset.name,
    fileName: asset.name,
    mimeType: (asset.mimeType as any) || 'application/pdf',
    sizeBytes: asset.size || blob.size || 1024,
    storagePath: path,
    visibility: 'INTERNAL',
    watermarkEnabled: true,
  });
}

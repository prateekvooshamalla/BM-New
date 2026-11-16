# Bharat Makaan Enterprise — Setup & Production Deployment Guide

## 1. Firebase Project Setup

1. Create staging and production projects in the Firebase Console (matching `.firebaserc`, or update `.firebaserc` with your project IDs).
2. Enable the following Firebase services:
   - **Authentication** (Email/Password + Identity Platform Multi-Factor Authentication / TOTP for privileged roles)
   - **Cloud Firestore** (Native mode, `asia-south1` Mumbai or `asia-south2` Delhi recommended for Indian low-latency operations)
   - **Cloud Functions (2nd Gen)** (Blaze plan required for Node 22 Cloud Functions v2 & outbound webhook calls)
   - **Cloud Storage**
   - **Cloud Messaging (FCM)**
   - **Firebase Hosting**

---

## 2. Environment & Secret Configuration

### Frontend Public Config (`apps/web/.env.local`)
```env
VITE_FIREBASE_API_KEY=your_firebase_web_api_key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project
VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_PUBLIC_APP_URL=https://bharatmakaan.com
VITE_GOOGLE_MAPS_API_KEY=your_http_referrer_restricted_maps_key
VITE_RAZORPAY_PUBLIC_KEY_ID=rzp_live_...
```

### Mobile Public Config (`apps/mobile/.env.local`)
```env
EXPO_PUBLIC_FIREBASE_API_KEY=your_firebase_api_key
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
EXPO_PUBLIC_FIREBASE_PROJECT_ID=your-project
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
EXPO_PUBLIC_FIREBASE_APP_ID=...
```

### Backend Secrets (Firebase Secret Manager / `functions/.env`)
```bash
firebase functions:secrets:set OPENAI_API_KEY
firebase functions:secrets:set WHATSAPP_ACCESS_TOKEN
firebase functions:secrets:set WHATSAPP_APP_SECRET
firebase functions:secrets:set WHATSAPP_VERIFY_TOKEN
firebase functions:secrets:set META_APP_SECRET
firebase functions:secrets:set GOOGLE_ADS_DEFAULT_WEBHOOK_SECRET
firebase functions:secrets:set RAZORPAY_KEY_SECRET
firebase functions:secrets:set RAZORPAY_WEBHOOK_SECRET
firebase functions:secrets:set RAZORPAY_SAAS_WEBHOOK_SECRET
```

---

## 3. Local Emulator Verification

Run the automated unit & deterministic regression suites:
```bash
pnpm test
```

Run the real Firebase Firestore Emulator Security Rules suite (requires Java 17+):
```bash
firebase emulators:exec --only firestore "pnpm test:emulator"
```

---

## 4. Production Deployment

1. **Generate SEO Sitemap & Build All Packages**:
   ```bash
   pnpm generate:sitemap
   pnpm build
   ```
2. **Deploy Security Rules, Indexes, Functions & Web Hosting**:
   ```bash
   firebase deploy --only firestore:rules,firestore:indexes,storage,functions,hosting
   ```
3. **Provision Platform Super Admin (`prateek.parts@gmail.com`)**:
   ```bash
   export GOOGLE_APPLICATION_CREDENTIALS="/secure/path/to/service-account.json"
   pnpm provision:super-admin
   ```
4. **Build Mobile Binaries (EAS Build)**:
   ```bash
   cd apps/mobile
   npx eas build --platform all
   ```

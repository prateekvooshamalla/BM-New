# Bharat Makaan Enterprise — Setup & Production Deployment Guide

## 1. Firebase Project Setup

1. Create staging and production projects in the Firebase Console (matching `.firebaserc`, or update `.firebaserc` with your project IDs).
2. Enable the following Firebase services:
   - **Authentication** (Email/Password + Google + Identity Platform Multi-Factor Authentication / TOTP for privileged roles)
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
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=your-web-oauth-client-id.apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=your-ios-oauth-client-id.apps.googleusercontent.com
```

### Google Sign-Up & Sign-In

The **Continue with Google** button on both sign-in and registration screens signs in existing users and creates a Firebase account for new users. Google supplies the user's name and email; users do not need to fill in the email/password form first. Existing organization membership synchronization and TOTP verification still apply.

1. In **Firebase Console → Authentication → Sign-in method**, enable **Google**, choose a project support email, and save. Keep Email/Password enabled for existing users. See the [Firebase Google sign-in guide](https://firebase.google.com/docs/auth/web/google-signin).
2. In **Authentication → Settings → Authorized domains**, add `localhost`, `bharatmakaan.com`, and any staging/preview domains you use. Enter hostnames without protocols, ports, or paths. Set `VITE_FIREBASE_AUTH_DOMAIN` to the project's Firebase auth domain. The web app uses a Google popup and does not require a client secret or a separate `VITE_GOOGLE_CLIENT_ID`.
3. For native mobile apps, obtain a **Web application** OAuth client ID from the same Google Cloud project and set `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`. Create an **Android** OAuth client for package `com.bharatmakaan.enterprise` and register the SHA-1 fingerprints for your development, release, and Google Play signing certificates.
4. Create an **iOS** OAuth client for bundle ID `com.bharatmakaan.enterprise` and set `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`. `apps/mobile/app.config.ts` derives its reversed URL scheme and configures the Google sign-in Expo plugin. This app exchanges the Google ID token through the Firebase JavaScript SDK, so native Firebase SDK configuration files are not required for this flow.
5. Rebuild the native app after adding the package or changing OAuth client IDs, using `pnpm exec expo run:android`, `pnpm exec expo run:ios`, or EAS Build from `apps/mobile`. Native Google sign-in needs a development or production build; Expo Go can still use email/password. The Expo web target uses a Firebase Google popup. See the [Expo Google sign-in setup](https://react-native-google-signin.github.io/docs/setting-up/expo).

Check a new Google account, a returning account, cancellation, and an account enrolled in TOTP before production rollout. Users can still register/sign in with email and reset passwords. If Firebase reports an existing account with a different provider, use the original sign-in method; the app does not merge accounts automatically.

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

Run the Google authentication regression suites:
```bash
pnpm --filter @bharat-makaan/web test:auth
pnpm --filter @bharat-makaan/mobile test:auth
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

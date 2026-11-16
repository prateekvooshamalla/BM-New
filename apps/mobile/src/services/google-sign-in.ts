import { Platform } from 'react-native';
import {
  GoogleAuthProvider,
  signInWithCredential,
  signInWithPopup,
} from 'firebase/auth';
import { mobileAuth } from './firebase';

export async function signInWithGoogle() {
  if (Platform.OS === 'web') {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    return signInWithPopup(mobileAuth, provider);
  }

  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  if (!webClientId || (Platform.OS === 'ios' && !iosClientId)) {
    throw new Error(
      'Google sign-in is currently unavailable. Please use email and password.'
    );
  }

  // Load native code only when needed so email sign-in still works in Expo Go.
  const { GoogleSignin, isSuccessResponse } = await import(
    '@react-native-google-signin/google-signin'
  ).catch(() => {
    throw new Error(
      'Google sign-in is unavailable in this version of the app. Please use email and password.'
    );
  });

  GoogleSignin.configure({ webClientId, iosClientId });
  if (Platform.OS === 'android') {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  }
  const response = await GoogleSignin.signIn();
  if (!isSuccessResponse(response)) return null;
  if (!response.data.idToken) {
    throw new Error('Google could not verify your account. Please try again.');
  }

  const credential = GoogleAuthProvider.credential(response.data.idToken);
  return signInWithCredential(mobileAuth, credential);
}

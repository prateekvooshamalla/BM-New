import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signInWithGoogle } from './google-sign-in';

const mocks = vi.hoisted(() => ({
  platform: { OS: 'android' },
  configure: vi.fn(),
  hasPlayServices: vi.fn(),
  nativeSignIn: vi.fn(),
  credential: vi.fn(),
  firebaseSignIn: vi.fn(),
  popup: vi.fn(),
  providerParameters: vi.fn(),
}));

vi.mock('react-native', () => ({ Platform: mocks.platform }));
vi.mock('./firebase', () => ({ mobileAuth: { name: 'mobile-auth' } }));
vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: class {
    static credential = mocks.credential;
    setCustomParameters = mocks.providerParameters;
  },
  signInWithCredential: mocks.firebaseSignIn,
  signInWithPopup: mocks.popup,
}));
vi.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: mocks.configure,
    hasPlayServices: mocks.hasPlayServices,
    signIn: mocks.nativeSignIn,
  },
  isSuccessResponse: (response: { type: string }) =>
    response.type === 'success',
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv(
    'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID',
    'web-client.apps.googleusercontent.com'
  );
  vi.stubEnv(
    'EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID',
    'ios-client.apps.googleusercontent.com'
  );
  mocks.platform.OS = 'android';
  mocks.nativeSignIn.mockResolvedValue({
    type: 'success',
    data: { idToken: 'google-id-token' },
  });
  mocks.credential.mockReturnValue({ providerId: 'google.com' });
  mocks.firebaseSignIn.mockResolvedValue({ user: { uid: 'google-user' } });
});
afterEach(() => vi.unstubAllEnvs());

describe('mobile Google authentication', () => {
  it('exchanges a native Google ID token for a Firebase session', async () => {
    const result = await signInWithGoogle();
    expect(result?.user.uid).toBe('google-user');
    expect(mocks.configure).toHaveBeenCalledWith({
      webClientId: 'web-client.apps.googleusercontent.com',
      iosClientId: 'ios-client.apps.googleusercontent.com',
    });
    expect(mocks.hasPlayServices).toHaveBeenCalledWith({
      showPlayServicesUpdateDialog: true,
    });
    expect(mocks.credential).toHaveBeenCalledWith('google-id-token');
    expect(mocks.firebaseSignIn).toHaveBeenCalledWith(
      { name: 'mobile-auth' },
      { providerId: 'google.com' }
    );
  });

  it('does not authenticate when the user cancels', async () => {
    mocks.nativeSignIn.mockResolvedValue({ type: 'cancelled', data: null });
    expect(await signInWithGoogle()).toBeNull();
    expect(mocks.credential).not.toHaveBeenCalled();
    expect(mocks.firebaseSignIn).not.toHaveBeenCalled();
  });

  it('rejects a response without an ID token', async () => {
    mocks.nativeSignIn.mockResolvedValue({
      type: 'success',
      data: { idToken: null },
    });
    await expect(signInWithGoogle()).rejects.toThrow(
      'could not verify your account'
    );
    expect(mocks.firebaseSignIn).not.toHaveBeenCalled();
  });

  it('keeps Firebase MFA challenges intact for the sign-in screen', async () => {
    const challenge = { code: 'auth/multi-factor-auth-required' };
    mocks.firebaseSignIn.mockRejectedValue(challenge);
    await expect(signInWithGoogle()).rejects.toBe(challenge);
  });

  it('reports missing OAuth configuration without opening Google', async () => {
    vi.stubEnv('EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID', '');
    await expect(signInWithGoogle()).rejects.toThrow('currently unavailable');
    expect(mocks.configure).not.toHaveBeenCalled();
    expect(mocks.nativeSignIn).not.toHaveBeenCalled();
  });

  it('requires the iOS client ID on iOS', async () => {
    mocks.platform.OS = 'ios';
    vi.stubEnv('EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID', '');
    await expect(signInWithGoogle()).rejects.toThrow('currently unavailable');
    expect(mocks.nativeSignIn).not.toHaveBeenCalled();
  });

  it('does not check Google Play Services on iOS', async () => {
    mocks.platform.OS = 'ios';
    await signInWithGoogle();
    expect(mocks.hasPlayServices).not.toHaveBeenCalled();
    expect(mocks.firebaseSignIn).toHaveBeenCalled();
  });

  it('uses a Firebase popup for Expo web without native OAuth configuration', async () => {
    mocks.platform.OS = 'web';
    vi.stubEnv('EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID', '');
    vi.stubEnv('EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID', '');
    mocks.popup.mockResolvedValue({ user: { uid: 'web-user' } });
    expect((await signInWithGoogle())?.user.uid).toBe('web-user');
    expect(mocks.popup).toHaveBeenCalledWith(
      { name: 'mobile-auth' },
      expect.anything()
    );
    expect(mocks.providerParameters).toHaveBeenCalledWith({
      prompt: 'select_account',
    });
    expect(mocks.nativeSignIn).not.toHaveBeenCalled();
  });
});

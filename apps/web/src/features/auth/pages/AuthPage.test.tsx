import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthPage } from './AuthPage';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  popup: vi.fn(),
  providerParameters: vi.fn(),
  emailSignIn: vi.fn(),
  register: vi.fn(),
  resetPassword: vi.fn(),
  updateProfile: vi.fn(),
  getMfaResolver: vi.fn(),
  assertion: vi.fn(),
}));

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => mocks.navigate,
}));
vi.mock('@bharat-makaan/config', () => ({
  BRAND_CONFIG: {
    name: 'Bharat Makaan',
    positioning: 'Your property workspace',
  },
}));
vi.mock('@/lib/firebase', () => ({ auth: { name: 'test-auth' } }));
vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: class {
    setCustomParameters = mocks.providerParameters;
  },
  signInWithPopup: mocks.popup,
  signInWithEmailAndPassword: mocks.emailSignIn,
  createUserWithEmailAndPassword: mocks.register,
  sendPasswordResetEmail: mocks.resetPassword,
  updateProfile: mocks.updateProfile,
  getMultiFactorResolver: mocks.getMfaResolver,
  TotpMultiFactorGenerator: {
    FACTOR_ID: 'totp',
    assertionForSignIn: mocks.assertion,
  },
}));

function renderAuth(mode: 'login' | 'register' = 'login') {
  return render(
    <MemoryRouter>
      <AuthPage defaultMode={mode} />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.popup.mockResolvedValue({ user: { uid: 'google-user' } });
  mocks.emailSignIn.mockResolvedValue({ user: { uid: 'email-user' } });
  mocks.register.mockResolvedValue({ user: { uid: 'new-user' } });
});
afterEach(cleanup);

describe('Google authentication', () => {
  it.each(['login', 'register'] as const)(
    'supports %s without filling the email form',
    async (mode) => {
      renderAuth(mode);
      fireEvent.click(
        screen.getByRole('button', { name: 'Continue with Google' })
      );

      await waitFor(() =>
        expect(mocks.navigate).toHaveBeenCalledWith('/app/dashboard')
      );
      expect(mocks.popup).toHaveBeenCalledTimes(1);
      expect(mocks.popup.mock.calls[0]?.[0]).toEqual({ name: 'test-auth' });
      expect(mocks.providerParameters).toHaveBeenCalledWith({
        prompt: 'select_account',
      });
      expect(mocks.register).not.toHaveBeenCalled();
      expect(mocks.emailSignIn).not.toHaveBeenCalled();
    }
  );

  it('disables both sign-in methods while the Google popup is open', async () => {
    let finish!: (result: unknown) => void;
    mocks.popup.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    renderAuth();
    fireEvent.click(
      screen.getByRole('button', { name: 'Continue with Google' })
    );

    expect(
      (
        screen.getByRole('button', {
          name: 'Connecting to Google...',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Sign In' }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    expect(mocks.navigate).not.toHaveBeenCalled();

    finish({ user: { uid: 'google-user' } });
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalled());
  });

  it.each(['auth/popup-closed-by-user', 'auth/cancelled-popup-request'])(
    'allows retry after %s',
    async (code) => {
      mocks.popup.mockRejectedValueOnce({ code });
      renderAuth();
      fireEvent.click(
        screen.getByRole('button', { name: 'Continue with Google' })
      );
      await waitFor(() =>
        expect(
          (
            screen.getByRole('button', {
              name: 'Continue with Google',
            }) as HTMLButtonElement
          ).disabled
        ).toBe(false)
      );
      expect(screen.queryByRole('alert')).toBeNull();
      expect(mocks.navigate).not.toHaveBeenCalled();

      fireEvent.click(
        screen.getByRole('button', { name: 'Continue with Google' })
      );
      await waitFor(() => expect(mocks.navigate).toHaveBeenCalled());
    }
  );

  it.each([
    ['auth/popup-blocked', 'Allow pop-ups'],
    [
      'auth/account-exists-with-different-credential',
      'original sign-in method',
    ],
    ['auth/operation-not-allowed', 'currently unavailable'],
    ['auth/unauthorized-domain', 'not available on this site'],
  ])('explains %s without navigating', async (code, message) => {
    mocks.popup.mockRejectedValueOnce({ code });
    renderAuth();
    fireEvent.click(
      screen.getByRole('button', { name: 'Continue with Google' })
    );
    expect((await screen.findByRole('alert')).textContent).toContain(message);
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('requires the enrolled TOTP factor before completing Google sign-in', async () => {
    const resolveSignIn = vi
      .fn()
      .mockResolvedValue({ user: { uid: 'google-user' } });
    const mfaError = { code: 'auth/multi-factor-auth-required' };
    mocks.popup.mockRejectedValueOnce(mfaError);
    mocks.assertion.mockReturnValue({ type: 'totp-assertion' });
    mocks.getMfaResolver.mockReturnValue({
      hints: [
        { factorId: 'phone', uid: 'phone-factor' },
        { factorId: 'totp', uid: 'totp-factor' },
      ],
      resolveSignIn,
    });
    renderAuth('register');
    fireEvent.click(
      screen.getByRole('button', { name: 'Continue with Google' })
    );

    const codeInput = await screen.findByLabelText(
      '6-Digit Authenticator Code'
    );
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('button', { name: 'Continue with Google' })
    ).toBeNull();
    fireEvent.change(codeInput, { target: { value: '123456' } });
    fireEvent.submit(
      screen.getByRole('button', { name: 'Verify & Sign In' }).closest('form')!
    );

    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith('/app/dashboard')
    );
    expect(mocks.assertion).toHaveBeenCalledWith('totp-factor', '123456');
    expect(resolveSignIn).toHaveBeenCalledWith({ type: 'totp-assertion' });
  });

  it('keeps password resets separate from Google sign-in', async () => {
    renderAuth();
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    expect(
      screen.queryByRole('button', { name: 'Continue with Google' })
    ).toBeNull();
    fireEvent.change(screen.getByLabelText('Email Address *'), {
      target: { value: 'buyer@example.com' },
    });
    fireEvent.submit(
      screen.getByRole('button', { name: 'Send Reset Link' }).closest('form')!
    );
    await waitFor(() =>
      expect(mocks.resetPassword).toHaveBeenCalledWith(
        { name: 'test-auth' },
        'buyer@example.com'
      )
    );
    expect(mocks.popup).not.toHaveBeenCalled();
  });

  it('preserves email and password sign-in', async () => {
    renderAuth();
    fireEvent.change(screen.getByLabelText('Email Address *'), {
      target: { value: 'buyer@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password *'), {
      target: { value: 'secret-password' },
    });
    fireEvent.submit(
      screen.getByRole('button', { name: 'Sign In' }).closest('form')!
    );
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith('/app/dashboard')
    );
    expect(mocks.emailSignIn).toHaveBeenCalledWith(
      { name: 'test-auth' },
      'buyer@example.com',
      'secret-password'
    );
    expect(mocks.popup).not.toHaveBeenCalled();
  });
});

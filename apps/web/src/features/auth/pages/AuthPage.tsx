import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  createUserWithEmailAndPassword,
  getMultiFactorResolver,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  TotpMultiFactorGenerator,
  updateProfile,
  type MultiFactorError,
  type MultiFactorResolver,
} from 'firebase/auth';
import { ShieldCheck } from 'lucide-react';
import { BRAND_CONFIG } from '@bharat-makaan/config';
import { auth } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function AuthPage({
  defaultMode = 'login',
}: {
  defaultMode?: 'login' | 'register';
}) {
  const navigate = useNavigate();
  const [mode, setMode] = React.useState<'login' | 'register' | 'reset'>(
    defaultMode
  );
  const [fullName, setFullName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [totpCode, setTotpCode] = React.useState('');
  const [mfaResolver, setMfaResolver] =
    React.useState<MultiFactorResolver | null>(null);
  const [loading, setLoading] = React.useState<
    'email' | 'google' | 'mfa' | null
  >(null);
  const [error, setError] = React.useState<string | null>(null);
  const [info, setInfo] = React.useState<string | null>(null);

  const handleAuthError = (err: unknown) => {
    const fbErr = err as MultiFactorError & { code?: string; message?: string };
    if (fbErr?.code === 'auth/multi-factor-auth-required') {
      setMfaResolver(getMultiFactorResolver(auth, fbErr));
      setTotpCode('');
    } else if (
      fbErr?.code !== 'auth/popup-closed-by-user' &&
      fbErr?.code !== 'auth/cancelled-popup-request'
    ) {
      const messages: Record<string, string> = {
        'auth/popup-blocked':
          'Allow pop-ups for this site, then try Google sign-in again.',
        'auth/account-exists-with-different-credential':
          'An account already uses this email. Sign in with your original sign-in method.',
        'auth/operation-not-allowed':
          'Google sign-in is currently unavailable. Please use email and password.',
        'auth/unauthorized-domain':
          'Google sign-in is not available on this site yet. Please use email and password.',
        'auth/network-request-failed':
          'Check your internet connection and try again.',
      };
      setError(
        messages[fbErr?.code ?? ''] ||
          fbErr?.message ||
          'Authentication failed.'
      );
    }
  };

  const handleGoogleAuth = async () => {
    if (loading) return;
    setError(null);
    setInfo(null);
    setLoading('google');
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider);
      navigate('/app/dashboard');
    } catch (err: unknown) {
      handleAuthError(err);
    } finally {
      setLoading(null);
    }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setInfo(null);
    setLoading('email');

    try {
      if (mode === 'reset') {
        await sendPasswordResetEmail(auth, email.trim());
        setInfo('Password reset instructions sent to your email.');
      } else if (mode === 'register') {
        const cred = await createUserWithEmailAndPassword(
          auth,
          email.trim(),
          password
        );
        if (fullName.trim()) {
          await updateProfile(cred.user, { displayName: fullName.trim() });
        }
        navigate('/app/dashboard');
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
        navigate('/app/dashboard');
      }
    } catch (err: unknown) {
      handleAuthError(err);
    } finally {
      setLoading(null);
    }
  };

  const handleMfaVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaResolver || loading) return;
    setLoading('mfa');
    setError(null);
    try {
      const hint = mfaResolver.hints.find(
        (factor) => factor.factorId === TotpMultiFactorGenerator.FACTOR_ID
      );
      if (!hint)
        throw new Error(
          'No enrolled authenticator found. Please use your original sign-in method.'
        );
      const assertion = TotpMultiFactorGenerator.assertionForSignIn(
        hint.uid,
        totpCode.trim()
      );
      await mfaResolver.resolveSignIn(assertion);
      navigate('/app/dashboard');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Invalid verification code.'
      );
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="flex min-h-screen flex-col justify-center bg-background px-4 py-12">
      <div className="mx-auto w-full max-w-md space-y-6">
        <div className="text-center space-y-1.5">
          <Link to="/" className="inline-flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground font-bold">
              BM
            </span>
            <span className="text-lg font-bold tracking-tight text-foreground">
              {BRAND_CONFIG.name}
            </span>
          </Link>
          <p className="text-xs text-muted-foreground">
            {BRAND_CONFIG.positioning}
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>
              {mfaResolver
                ? 'Two-Factor Verification'
                : mode === 'login'
                  ? 'Sign in to Bharat Makaan'
                  : mode === 'register'
                    ? 'Create Enterprise or Buyer Account'
                    : 'Reset Account Password'}
            </CardTitle>
            <CardDescription>
              {mfaResolver
                ? 'Enter the 6-digit authenticator code for your privileged account.'
                : mode === 'login'
                  ? 'Access your builder workspace, channel partner portal, or saved properties.'
                  : mode === 'register'
                    ? 'Register with your official email to onboard a builder organization or explore properties.'
                    : 'Enter your registered email address to receive a secure reset link.'}
            </CardDescription>
          </CardHeader>

          <CardContent>
            {error && (
              <div
                role="alert"
                className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800"
              >
                {error}
              </div>
            )}
            {info && (
              <div
                role="status"
                className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"
              >
                {info}
              </div>
            )}

            {mfaResolver ? (
              <form onSubmit={handleMfaVerify} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="mfa-code">6-Digit Authenticator Code</Label>
                  <Input
                    id="mfa-code"
                    required
                    inputMode="numeric"
                    maxLength={6}
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value)}
                    placeholder="000000"
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={Boolean(loading)}
                >
                  <ShieldCheck className="h-4 w-4" />
                  {loading ? 'Verifying...' : 'Verify & Sign In'}
                </Button>
              </form>
            ) : (
              <>
                {mode !== 'reset' && (
                  <div className="mb-5 space-y-4">
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      disabled={Boolean(loading)}
                      onClick={handleGoogleAuth}
                    >
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 24 24"
                        className="h-4 w-4"
                      >
                        <path
                          fill="#4285F4"
                          d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.36Z"
                        />
                        <path
                          fill="#34A853"
                          d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.05.96-3.38.96-2.6 0-4.8-1.76-5.59-4.12H3.07v2.59A10 10 0 0 0 12 22Z"
                        />
                        <path
                          fill="#FBBC05"
                          d="M6.41 13.92a6 6 0 0 1 0-3.84V7.49H3.07a10 10 0 0 0 0 9.02l3.34-2.59Z"
                        />
                        <path
                          fill="#EA4335"
                          d="M12 5.96c1.47 0 2.79.5 3.82 1.5l2.87-2.87A9.59 9.59 0 0 0 12 2a10 10 0 0 0-8.93 5.49l3.34 2.59C7.2 7.72 9.4 5.96 12 5.96Z"
                        />
                      </svg>
                      {loading === 'google'
                        ? 'Connecting to Google...'
                        : 'Continue with Google'}
                    </Button>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <div className="h-px flex-1 bg-border" />
                      <span>or continue with email</span>
                      <div className="h-px flex-1 bg-border" />
                    </div>
                  </div>
                )}
                <form onSubmit={handleAuth} className="space-y-4">
                  {mode === 'register' && (
                    <div className="space-y-1.5">
                      <Label htmlFor="auth-name">Full Name *</Label>
                      <Input
                        id="auth-name"
                        required
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder="Enter your full name"
                      />
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <Label htmlFor="auth-email">Email Address *</Label>
                    <Input
                      id="auth-email"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@company.com"
                    />
                  </div>

                  {mode !== 'reset' && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="auth-password">Password *</Label>
                        {mode === 'login' && (
                          <button
                            type="button"
                            disabled={Boolean(loading)}
                            onClick={() => setMode('reset')}
                            className="text-xs text-primary hover:underline cursor-pointer"
                          >
                            Forgot password?
                          </button>
                        )}
                      </div>
                      <Input
                        id="auth-password"
                        type="password"
                        required
                        minLength={8}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Minimum 8 characters"
                      />
                    </div>
                  )}

                  <Button
                    type="submit"
                    className="w-full"
                    disabled={Boolean(loading)}
                  >
                    {loading === 'email'
                      ? 'Please wait...'
                      : mode === 'login'
                        ? 'Sign In'
                        : mode === 'register'
                          ? 'Create Account'
                          : 'Send Reset Link'}
                  </Button>

                  <div className="pt-2 text-center text-xs text-muted-foreground">
                    {mode === 'login' ? (
                      <>
                        New to Bharat Makaan?{' '}
                        <button
                          type="button"
                          disabled={Boolean(loading)}
                          onClick={() => setMode('register')}
                          className="font-medium text-primary hover:underline cursor-pointer"
                        >
                          Create an account
                        </button>
                      </>
                    ) : (
                      <>
                        Already have an account?{' '}
                        <button
                          type="button"
                          disabled={Boolean(loading)}
                          onClick={() => setMode('login')}
                          className="font-medium text-primary hover:underline cursor-pointer"
                        >
                          Sign in
                        </button>
                      </>
                    )}
                  </div>
                </form>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

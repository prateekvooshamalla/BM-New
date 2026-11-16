import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  createUserWithEmailAndPassword,
  getMultiFactorResolver,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  TotpMultiFactorGenerator,
  updateProfile,
  type MultiFactorError,
  type MultiFactorResolver,
} from 'firebase/auth';
import { ShieldCheck } from 'lucide-react';
import { BRAND_CONFIG } from '@bharat-makaan/config';
import { auth } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function AuthPage({ defaultMode = 'login' }: { defaultMode?: 'login' | 'register' }) {
  const navigate = useNavigate();
  const [mode, setMode] = React.useState<'login' | 'register' | 'reset'>(defaultMode);
  const [fullName, setFullName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [totpCode, setTotpCode] = React.useState('');
  const [mfaResolver, setMfaResolver] = React.useState<MultiFactorResolver | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [info, setInfo] = React.useState<string | null>(null);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);

    try {
      if (mode === 'reset') {
        await sendPasswordResetEmail(auth, email.trim());
        setInfo('Password reset instructions sent to your email.');
      } else if (mode === 'register') {
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        if (fullName.trim()) {
          await updateProfile(cred.user, { displayName: fullName.trim() });
        }
        navigate('/app/dashboard');
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
        navigate('/app/dashboard');
      }
    } catch (err: unknown) {
      const fbErr = err as MultiFactorError & { code?: string; message?: string };
      if (fbErr?.code === 'auth/multi-factor-auth-required') {
        const resolver = getMultiFactorResolver(auth, fbErr);
        setMfaResolver(resolver);
      } else {
        setError(fbErr?.message || 'Authentication failed.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleMfaVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaResolver) return;
    setLoading(true);
    setError(null);
    try {
      const hint = mfaResolver.hints[0];
      if (!hint) throw new Error('No enrolled second factor found.');
      const assertion = TotpMultiFactorGenerator.assertionForSignIn(hint.uid, totpCode.trim());
      await mfaResolver.resolveSignIn(assertion);
      navigate('/app/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid verification code.');
    } finally {
      setLoading(false);
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
          <p className="text-xs text-muted-foreground">{BRAND_CONFIG.positioning}</p>
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
              <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                {error}
              </div>
            )}
            {info && (
              <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
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
                <Button type="submit" className="w-full" disabled={loading}>
                  <ShieldCheck className="h-4 w-4" />
                  {loading ? 'Verifying...' : 'Verify & Sign In'}
                </Button>
              </form>
            ) : (
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

                <Button type="submit" className="w-full" disabled={loading}>
                  {loading
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
                        onClick={() => setMode('login')}
                        className="font-medium text-primary hover:underline cursor-pointer"
                      >
                        Sign in
                      </button>
                    </>
                  )}
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

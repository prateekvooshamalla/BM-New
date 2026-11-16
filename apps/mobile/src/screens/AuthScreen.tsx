import React, { useState } from 'react';
import { SafeAreaView, StyleSheet, Text, View } from 'react-native';
import {
  createUserWithEmailAndPassword,
  getMultiFactorResolver,
  signInWithEmailAndPassword,
  TotpMultiFactorGenerator,
  type MultiFactorError,
  type MultiFactorResolver,
} from 'firebase/auth';
import { BRAND_CONFIG, DESIGN_TOKENS } from '@bharat-makaan/config';
import { mobileAuth } from '../services/firebase';
import { signInWithGoogle } from '../services/google-sign-in';
import {
  NativeButton,
  NativeCard,
  NativeInput,
} from '../components/NativePrimitives';

const palette = DESIGN_TOKENS.colors.light;

export function AuthScreen() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState<'email' | 'google' | 'mfa' | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [mfaResolver, setMfaResolver] = useState<MultiFactorResolver | null>(
    null
  );
  const [totpCode, setTotpCode] = useState('');

  const handleAuthError = (err: unknown) => {
    const authError = err as MultiFactorError;
    if (authError?.code === 'auth/multi-factor-auth-required') {
      setMfaResolver(getMultiFactorResolver(mobileAuth, authError));
      setTotpCode('');
    } else if (
      authError?.code !== 'auth/popup-closed-by-user' &&
      authError?.code !== 'auth/cancelled-popup-request'
    ) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    }
  };

  const handleGoogleAuth = async () => {
    if (loading) return;
    setError(null);
    setLoading('google');
    try {
      await signInWithGoogle();
    } catch (err) {
      handleAuthError(err);
    } finally {
      setLoading(null);
    }
  };

  const handleSubmit = async () => {
    if (loading) return;
    setError(null);
    setLoading('email');
    try {
      if (mode === 'login') {
        await signInWithEmailAndPassword(mobileAuth, email.trim(), password);
      } else {
        await createUserWithEmailAndPassword(
          mobileAuth,
          email.trim(),
          password
        );
      }
    } catch (err) {
      handleAuthError(err);
    } finally {
      setLoading(null);
    }
  };

  const handleMfaVerify = async () => {
    if (!mfaResolver || loading) return;
    setError(null);
    setLoading('mfa');
    try {
      const hint = mfaResolver.hints.find(
        (factor) => factor.factorId === TotpMultiFactorGenerator.FACTOR_ID
      );
      if (!hint)
        throw new Error(
          'No enrolled authenticator found. Please use your original sign-in method.'
        );
      await mfaResolver.resolveSignIn(
        TotpMultiFactorGenerator.assertionForSignIn(hint.uid, totpCode.trim())
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Invalid verification code.'
      );
    } finally {
      setLoading(null);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inner}>
        <Text style={styles.brand}>{BRAND_CONFIG.name}</Text>
        <Text style={styles.sub}>{BRAND_CONFIG.positioning}</Text>

        <View style={{ marginTop: 20 }}>
          <NativeCard>
            {error ? <Text style={styles.err}>{error}</Text> : null}
            {mfaResolver ? (
              <>
                <NativeInput
                  label="6-Digit Authenticator Code"
                  keyboardType="number-pad"
                  maxLength={6}
                  value={totpCode}
                  onChangeText={setTotpCode}
                  placeholder="000000"
                />
                <NativeButton
                  label="Verify & Sign In"
                  loading={loading === 'mfa'}
                  disabled={Boolean(loading) || totpCode.trim().length !== 6}
                  onPress={handleMfaVerify}
                />
              </>
            ) : (
              <>
                <NativeButton
                  variant="outline"
                  label="Continue with Google"
                  loading={loading === 'google'}
                  disabled={Boolean(loading)}
                  onPress={handleGoogleAuth}
                />
                <Text style={styles.divider}>or continue with email</Text>
                <NativeInput
                  label="Work Email"
                  autoCapitalize="none"
                  keyboardType="email-address"
                  placeholder="you@builder.in"
                  value={email}
                  onChangeText={setEmail}
                />
                <NativeInput
                  label="Password"
                  secureTextEntry
                  placeholder="Minimum 8 characters"
                  value={password}
                  onChangeText={setPassword}
                />
                <NativeButton
                  label={mode === 'login' ? 'Sign In' : 'Create Account'}
                  loading={loading === 'email'}
                  disabled={Boolean(loading)}
                  onPress={handleSubmit}
                />
                <View style={{ marginTop: 10 }}>
                  <NativeButton
                    variant="outline"
                    label={
                      mode === 'login'
                        ? 'Switch to Register'
                        : 'Switch to Sign In'
                    }
                    disabled={Boolean(loading)}
                    onPress={() =>
                      setMode(mode === 'login' ? 'register' : 'login')
                    }
                  />
                </View>
              </>
            )}
          </NativeCard>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: palette.background,
    justifyContent: 'center',
  },
  inner: { padding: 20 },
  brand: {
    fontSize: 24,
    fontWeight: '700',
    color: palette.primary,
    textAlign: 'center',
  },
  sub: {
    fontSize: 12,
    color: palette.mutedForeground,
    textAlign: 'center',
    marginTop: 4,
  },
  err: { fontSize: 12, color: palette.danger, marginBottom: 10 },
  divider: {
    fontSize: 12,
    color: palette.mutedForeground,
    textAlign: 'center',
    marginVertical: 14,
  },
});

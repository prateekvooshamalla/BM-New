import React, { useState } from 'react';
import { SafeAreaView, StyleSheet, Text, View } from 'react-native';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from 'firebase/auth';
import { BRAND_CONFIG, DESIGN_TOKENS } from '@bharat-makaan/config';
import { mobileAuth } from '../services/firebase';
import { NativeButton, NativeCard, NativeInput } from '../components/NativePrimitives';

const palette = DESIGN_TOKENS.colors.light;

export function AuthScreen() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    setLoading(true);
    try {
      if (mode === 'login') {
        await signInWithEmailAndPassword(mobileAuth, email.trim(), password);
      } else {
        await createUserWithEmailAndPassword(mobileAuth, email.trim(), password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setLoading(false);
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
              loading={loading}
              onPress={handleSubmit}
            />
            <View style={{ marginTop: 10 }}>
              <NativeButton
                variant="outline"
                label={mode === 'login' ? 'Switch to Register' : 'Switch to Sign In'}
                onPress={() => setMode(mode === 'login' ? 'register' : 'login')}
              />
            </View>
          </NativeCard>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.background, justifyContent: 'center' },
  inner: { padding: 20 },
  brand: { fontSize: 24, fontWeight: '700', color: palette.primary, textAlign: 'center' },
  sub: { fontSize: 12, color: palette.mutedForeground, textAlign: 'center', marginTop: 4 },
  err: { fontSize: 12, color: palette.danger, marginBottom: 10 },
});

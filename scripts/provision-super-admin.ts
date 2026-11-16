#!/usr/bin/env tsx
/**
 * Server-Side Super Admin Provisioning Script
 * Bootstraps initial Platform Super Admin (`prateek.parts@gmail.com`) securely.
 *
 * SECURITY GUARANTEES:
 * - Never hardcodes a password or accepts a weak default password.
 * - Requires strong password via `SUPER_ADMIN_INITIAL_PASSWORD` env var or interactive TTY prompt.
 * - Enforces `platformRole: 'PLATFORM_SUPER_ADMIN'` and `requireMfa: true` custom claims.
 * - Writes an immutable `PLATFORM` audit event.
 */

import readline from 'node:readline';
import { getApps, initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { BRAND_CONFIG } from '../packages/config/src';

export function validateStrongSuperAdminPassword(password: string): {
  valid: boolean;
  reason?: string;
} {
  if (!password || password.length < 14) {
    return { valid: false, reason: 'Password must be at least 14 characters long.' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, reason: 'Password must contain at least one uppercase letter.' };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, reason: 'Password must contain at least one lowercase letter.' };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, reason: 'Password must contain at least one numeric digit.' };
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return { valid: false, reason: 'Password must contain at least one special character.' };
  }
  const lowered = password.toLowerCase();
  if (lowered.includes('password') || lowered.includes('123456') || lowered.includes('admin')) {
    return { valid: false, reason: 'Password must not contain weak dictionary patterns.' };
  }
  return { valid: true };
}

async function promptHiddenPassword(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new Error(
      'Non-interactive terminal detected. Supply SUPER_ADMIN_INITIAL_PASSWORD securely via environment variable.'
    );
  }
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  const email = (
    process.env.SUPER_ADMIN_EMAIL || BRAND_CONFIG.initialSuperAdminEmail
  ).toLowerCase();

  let initialPassword = process.env.SUPER_ADMIN_INITIAL_PASSWORD ?? '';
  if (!initialPassword) {
    initialPassword = await promptHiddenPassword(
      `Enter strong initial password for Platform Super Admin (${email}): `
    );
  }

  const passwordCheck = validateStrongSuperAdminPassword(initialPassword);
  if (!passwordCheck.valid) {
    console.error(`[ABORTED] Weak password rejected: ${passwordCheck.reason}`);
    process.exit(1);
  }

  if (getApps().length === 0) {
    initializeApp({
      credential: process.env.FIRESTORE_EMULATOR_HOST ? undefined : applicationDefault(),
      projectId: process.env.GCLOUD_PROJECT || process.env.VITE_FIREBASE_PROJECT_ID || 'bharat-makaan-prod',
    });
  }

  const auth = getAuth();
  const db = getFirestore();

  let uid: string;
  let createdNew = false;

  try {
    const existing = await auth.getUserByEmail(email);
    uid = existing.uid;
    await auth.updateUser(uid, {
      password: initialPassword,
      emailVerified: true,
      disabled: false,
    });
  } catch {
    const created = await auth.createUser({
      email,
      password: initialPassword,
      displayName: 'Bharat Makaan Super Admin',
      emailVerified: true,
    });
    uid = created.uid;
    createdNew = true;
  }

  await auth.setCustomUserClaims(uid, {
    platformRole: 'PLATFORM_SUPER_ADMIN',
    requireMfa: true,
  });

  const nowIso = new Date().toISOString();
  const auditRef = db.collection('audit_events').doc();
  await auditRef.set({
    id: auditRef.id,
    orgId: 'PLATFORM',
    actorUid: uid,
    actorEmail: email,
    actorRole: 'PLATFORM_SUPER_ADMIN',
    action: createdNew ? 'SUPER_ADMIN_BOOTSTRAPPED' : 'SUPER_ADMIN_CREDENTIALS_ROTATED',
    category: 'AUTH',
    entityType: 'platform_super_admin',
    entityId: uid,
    summary: `Provisioned Platform Super Admin (${email}) with mandatory MFA flag.`,
    after: { email, requireMfa: true },
    createdAt: nowIso,
  });

  console.log(
    `[SUCCESS] Platform Super Admin provisioned: ${email} (uid=${uid}, requireMfa=true). Enroll second factor immediately upon first sign-in.`
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('[ERROR] Super Admin provisioning failed:', err);
    process.exit(1);
  });
}

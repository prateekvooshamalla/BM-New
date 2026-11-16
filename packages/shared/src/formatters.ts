/**
 * @bharat-makaan/shared — Indian Real Estate Formatters, Lead Normalization & Meta Window Guards
 */

import type { Lead } from './entities';

const inrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

const inrPaiseFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const indianNumberFormatter = new Intl.NumberFormat('en-IN');

export function formatInr(amount: number, includePaise = false): string {
  if (!Number.isFinite(amount)) return '₹0';
  return includePaise ? inrPaiseFormatter.format(amount) : inrFormatter.format(amount);
}

export function formatInrCompact(amount: number): string {
  if (!Number.isFinite(amount) || amount === 0) return '₹0';
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';
  if (abs >= 10_000_000) {
    return `${sign}₹${(abs / 10_000_000).toFixed(2)} Cr`;
  }
  if (abs >= 100_000) {
    return `${sign}₹${(abs / 100_000).toFixed(2)} L`;
  }
  return `${sign}${inrFormatter.format(abs)}`;
}

export function formatAreaSqft(area: number): string {
  if (!Number.isFinite(area)) return '0 sq. ft.';
  return `${indianNumberFormatter.format(area)} sq. ft.`;
}

export function normalizeIndianPhone(rawPhone: string): string {
  const digits = rawPhone.replace(/\D/g, '');
  if (digits.length === 10) {
    return `+91${digits}`;
  }
  if (digits.length === 12 && digits.startsWith('91')) {
    return `+${digits}`;
  }
  if (digits.length === 11 && digits.startsWith('0')) {
    return `+91${digits.slice(1)}`;
  }
  return rawPhone.trim().startsWith('+') ? `+${digits}` : `+${digits}`;
}

export function normalizeEmail(rawEmail?: string | null): string | undefined {
  if (!rawEmail) return undefined;
  const trimmed = rawEmail.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Deterministic baseline lead score (0-100) based on real buyer attributes & engagement.
 */
export function computeDeterministicLeadScore(
  lead: Partial<
    Pick<
      Lead,
      | 'budgetMaxInr'
      | 'buyingTimeline'
      | 'preferredProjectIds'
      | 'email'
      | 'stage'
      | 'qualificationStatus'
    >
  >
): number {
  let score = 20;
  if (lead.email) score += 10;
  if (lead.budgetMaxInr && lead.budgetMaxInr > 0) score += 15;
  if (lead.preferredProjectIds && lead.preferredProjectIds.length > 0) score += 15;

  switch (lead.buyingTimeline) {
    case 'IMMEDIATE':
      score += 25;
      break;
    case '1_TO_3_MONTHS':
      score += 18;
      break;
    case '3_TO_6_MONTHS':
      score += 10;
      break;
    case '6_PLUS_MONTHS':
      score += 5;
      break;
  }

  if (lead.stage === 'VISITED' || lead.stage === 'NEGOTIATION') score += 15;
  if (lead.qualificationStatus === 'HOT') score += 10;
  if (lead.qualificationStatus === 'DISQUALIFIED') return 5;

  return Math.min(100, Math.max(0, score));
}

/**
 * Evaluates whether the 24-hour Meta WhatsApp Cloud API customer-service window is open.
 * Outside this window, only approved WhatsApp templates may be sent.
 */
export function isWithinMetaServiceWindow(
  lastCustomerMessageAt?: string | null,
  nowMs: number = Date.now()
): boolean {
  if (!lastCustomerMessageAt) return false;
  const lastTs = Date.parse(lastCustomerMessageAt);
  if (Number.isNaN(lastTs)) return false;
  const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
  return nowMs - lastTs <= TWENTY_FOUR_HOURS_MS && nowMs >= lastTs;
}

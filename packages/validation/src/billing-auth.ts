/**
 * @bharat-makaan/validation — Strict Schemas for Two-Package Razorpay Billing,
 * Optional Assisted Onboarding, Prepaid AI/WhatsApp Wallets & 4-Persona Access
 */

import { z } from 'zod';
import {
  BUILDER_PACKAGE_CODES,
  MAX_CUSTOM_WALLET_TOPUP_INR,
  MIN_CUSTOM_WALLET_TOPUP_INR,
  ONBOARDING_SERVICE_CODES,
} from '@bharat-makaan/shared';

export const builderPackageCodeSchema = z.enum(BUILDER_PACKAGE_CODES);
export const onboardingServiceCodeSchema = z.enum(ONBOARDING_SERVICE_CODES);
export const prepaidWalletTypeSchema = z.enum(['AI', 'WHATSAPP']);

export const previewSubscriptionPricingSchema = z.object({
  orgId: z.string().min(1),
  packageCode: builderPackageCodeSchema,
  requestedProjectCapacity: z.coerce.number().int().min(1).max(500).default(1),
  onboardingServiceCode: onboardingServiceCodeSchema.optional(),
});

export const initiateSubscriptionCheckoutSchema = z.object({
  orgId: z.string().min(1),
  packageCode: builderPackageCodeSchema,
  requestedProjectCapacity: z.coerce.number().int().min(1).max(500).default(1),
  onboardingServiceCode: onboardingServiceCodeSchema.default('SELF_SERVICE'),
  onboardingNotes: z.string().max(600).optional(),
  clientPlatform: z.enum(['WEB', 'IOS', 'ANDROID']).default('WEB'),
  idempotencyKey: z.string().min(6).max(120),
});

export const changeSubscriptionCapacitySchema = z.object({
  orgId: z.string().min(1),
  targetPackageCode: builderPackageCodeSchema,
  targetProjectCapacity: z.coerce.number().int().min(1).max(500),
  retainedActiveProjectIds: z.array(z.string().min(1)).optional(),
  clientPlatform: z.enum(['WEB', 'IOS', 'ANDROID']).default('WEB'),
  idempotencyKey: z.string().min(6).max(120),
});

export const cancelSubscriptionSchema = z.object({
  orgId: z.string().min(1),
  cancelImmediately: z.boolean().default(false),
  reason: z.string().min(3).max(400),
});

export const initiateWalletTopupSchema = z.object({
  orgId: z.string().min(1),
  walletType: prepaidWalletTypeSchema,
  amountInr: z.coerce
    .number()
    .int('Top-up amount must be a whole INR value')
    .min(MIN_CUSTOM_WALLET_TOPUP_INR, `Minimum top-up is ₹${MIN_CUSTOM_WALLET_TOPUP_INR}`)
    .max(MAX_CUSTOM_WALLET_TOPUP_INR, `Maximum single top-up is ₹${MAX_CUSTOM_WALLET_TOPUP_INR}`),
  clientPlatform: z.enum(['WEB', 'IOS', 'ANDROID']).default('WEB'),
  idempotencyKey: z.string().min(6).max(120),
});

export const verifyRazorpayCheckoutSignatureSchema = z.object({
  orgId: z.string().min(1),
  checkoutKind: z.enum(['SUBSCRIPTION', 'ONBOARDING', 'WALLET_TOPUP']),
  referenceId: z.string().min(1),
  razorpayPaymentId: z.string().min(4),
  razorpayOrderId: z.string().optional(),
  razorpaySubscriptionId: z.string().optional(),
  razorpaySignature: z.string().min(8),
});

export const setProjectLifecycleStatusSchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  lifecycleStatus: z.enum(['ACTIVE', 'ARCHIVED_READ_ONLY']),
  reason: z.string().min(3).max(300),
});

export const approvePartnerScopeSchema = z.object({
  orgId: z.string().min(1),
  partnerOrgId: z.string().min(1),
  decision: z.enum(['AUTHORIZED', 'SUSPENDED']),
  projectIds: z.array(z.string().min(1)).default([]),
  commissionPct: z.coerce.number().min(0).max(25).optional(),
  commissionTerms: z.string().max(400).optional(),
  reason: z.string().min(3).max(300),
});

export const toggleCustomerSavedPropertySchema = z.object({
  unitId: z.string().min(1),
});

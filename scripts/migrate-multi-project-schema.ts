#!/usr/bin/env tsx
/**
 * Non-Destructive Multi-Project Global Schema Migration Utility
 *
 * GUARANTEES:
 * - Zero deletions or destructive overwrites (`merge: true` only for missing global fields).
 * - Preserves all existing organizations, projects, units, leads, bookings, quotations, and audit logs.
 * - Supports `--dry-run` mode to preview field backfills safely before writing.
 */

import { getApps, initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import {
  GLOBAL_COUNTRIES,
  PROJECT_STRUCTURE_TEMPLATES,
  type ProjectStructureTemplateKey,
} from '../packages/config/src';
import { toMinorUnits } from '../packages/shared/src/formatters';

function resolveDefaultTemplate(projectType?: string): ProjectStructureTemplateKey {
  switch (projectType) {
    case 'VILLA':
    case 'INDEPENDENT_HOUSE':
      return 'VILLA_COMMUNITY';
    case 'PLOTTED':
      return 'PLOTTED_LAYOUT';
    case 'COMMERCIAL':
    case 'OFFICE':
    case 'RETAIL':
      return 'COMMERCIAL_BUILDING';
    case 'MIXED':
    case 'RESALE_PORTFOLIO':
    case 'RENTAL_PORTFOLIO':
      return 'CUSTOM_HIERARCHY';
    default:
      return 'APARTMENT_TOWER';
  }
}

export async function runMultiProjectSchemaMigration(
  db: Firestore,
  options: { dryRun?: boolean } = {}
): Promise<{
  dryRun: boolean;
  organizationsNormalized: number;
  projectsNormalized: number;
  unitsNormalized: number;
  priceBooksNormalized: number;
}> {
  const dryRun = Boolean(options.dryRun);
  const nowIso = new Date().toISOString();

  let organizationsNormalized = 0;
  let projectsNormalized = 0;
  let unitsNormalized = 0;
  let priceBooksNormalized = 0;

  // 1. Backfill Organizations
  const orgsSnap = await db.collection('organizations').get();
  for (const docSnap of orgsSnap.docs) {
    const d = docSnap.data();
    const countryCode = (d.countryCode || 'IN').toUpperCase();
    const countryCfg = GLOBAL_COUNTRIES[countryCode] ?? GLOBAL_COUNTRIES.IN!;
    const patch: Record<string, unknown> = {};

    if (!d.organizationType) patch.organizationType = 'BUILDER';
    if (!d.countryCode) patch.countryCode = countryCode;
    if (!d.defaultCurrency) patch.defaultCurrency = countryCfg.defaultCurrency;
    if (!d.defaultAreaUnit) patch.defaultAreaUnit = countryCfg.defaultAreaUnit;
    if (!d.defaultTimezone) patch.defaultTimezone = countryCfg.defaultTimezone;
    if (!d.regulatoryAuthorityLabel) {
      patch.regulatoryAuthorityLabel = countryCfg.regulatoryAuthorityLabel;
    }
    if (!d.taxRegime) {
      patch.taxRegime = {
        primaryTaxLabel: countryCfg.primaryTaxLabel,
        primaryTaxPct: countryCfg.defaultPrimaryTaxPct,
        secondaryTaxLabel: countryCfg.secondaryTaxLabel,
        secondaryTaxPct: countryCfg.defaultSecondaryTaxPct,
        exemptLabel: 'Tax Exempt',
      };
    }

    if (Object.keys(patch).length > 0) {
      organizationsNormalized++;
      if (!dryRun) {
        await docSnap.ref.set({ ...patch, updatedAt: d.updatedAt ?? nowIso }, { merge: true });
      }
    }
  }

  // 2. Backfill Projects
  const projectsSnap = await db.collection('projects').get();
  for (const docSnap of projectsSnap.docs) {
    const d = docSnap.data();
    const countryCode = (d.countryCode || 'IN').toUpperCase();
    const countryCfg = GLOBAL_COUNTRIES[countryCode] ?? GLOBAL_COUNTRIES.IN!;
    const tplKey = (d.structureTemplate as ProjectStructureTemplateKey) ?? resolveDefaultTemplate(d.projectType);
    const tpl = PROJECT_STRUCTURE_TEMPLATES[tplKey] ?? PROJECT_STRUCTURE_TEMPLATES.APARTMENT_TOWER;
    const patch: Record<string, unknown> = {};

    if (!d.countryCode) patch.countryCode = countryCode;
    if (!d.currencyCode) patch.currencyCode = countryCfg.defaultCurrency;
    if (!d.areaUnit) patch.areaUnit = countryCfg.defaultAreaUnit;
    if (!d.timezone) patch.timezone = countryCfg.defaultTimezone;
    if (!d.structureTemplate) patch.structureTemplate = tplKey;
    if (!d.hierarchyLabels) {
      patch.hierarchyLabels = {
        ...tpl.hierarchyLabels,
        requiresStructure: tpl.requiresStructure,
        requiresFloor: tpl.requiresFloor,
      };
    }
    if (!d.regulatoryAuthorityLabel) {
      patch.regulatoryAuthorityLabel = countryCfg.regulatoryAuthorityLabel;
    }

    if (Object.keys(patch).length > 0) {
      projectsNormalized++;
      if (!dryRun) {
        await docSnap.ref.set({ ...patch, updatedAt: d.updatedAt ?? nowIso }, { merge: true });
      }
    }
  }

  // 3. Backfill Units
  const unitsSnap = await db.collection('units').get();
  for (const docSnap of unitsSnap.docs) {
    const d = docSnap.data();
    const currencyCode = d.currencyCode || 'INR';
    const patch: Record<string, unknown> = {};

    if (!d.inventorySource) patch.inventorySource = 'PRIMARY_DEVELOPER';
    if (!d.currencyCode) patch.currencyCode = currencyCode;
    if (!d.areaUnit) patch.areaUnit = 'SQFT';
    if (!d.pricingMode) patch.pricingMode = 'PER_AREA';
    if (d.primaryArea === undefined && typeof d.saleableAreaSqft === 'number') {
      patch.primaryArea = d.saleableAreaSqft;
    }
    if (d.secondaryArea === undefined && typeof d.carpetAreaSqft === 'number') {
      patch.secondaryArea = d.carpetAreaSqft;
    }
    if (d.calculatedTotalMinor === undefined && typeof d.calculatedTotalPrice === 'number') {
      patch.calculatedTotalMinor = toMinorUnits(d.calculatedTotalPrice, currencyCode);
    }

    if (Object.keys(patch).length > 0) {
      unitsNormalized++;
      if (!dryRun) {
        await docSnap.ref.set({ ...patch, updatedAt: d.updatedAt ?? nowIso }, { merge: true });
      }
    }
  }

  // 4. Backfill Price Books
  const pbSnap = await db.collection('price_books').get();
  for (const docSnap of pbSnap.docs) {
    const d = docSnap.data();
    const patch: Record<string, unknown> = {};

    if (!d.currencyCode) patch.currencyCode = 'INR';
    if (!d.areaUnit) patch.areaUnit = 'SQFT';
    if (!d.pricingMode) patch.pricingMode = 'PER_AREA';
    if (d.taxConfig && !d.taxConfig.primaryTaxLabel) {
      patch.taxConfig = {
        ...d.taxConfig,
        primaryTaxLabel: 'GST',
        secondaryTaxLabel: 'Service GST',
        exemptTaxLabel: 'Tax Exempt',
      };
    }

    if (Object.keys(patch).length > 0) {
      priceBooksNormalized++;
      if (!dryRun) {
        await docSnap.ref.set({ ...patch, updatedAt: d.updatedAt ?? nowIso }, { merge: true });
      }
    }
  }

  return {
    dryRun,
    organizationsNormalized,
    projectsNormalized,
    unitsNormalized,
    priceBooksNormalized,
  };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  if (getApps().length === 0) {
    initializeApp({
      credential: process.env.FIRESTORE_EMULATOR_HOST ? undefined : applicationDefault(),
      projectId:
        process.env.GCLOUD_PROJECT ||
        process.env.VITE_FIREBASE_PROJECT_ID ||
        'bharat-makaan-prod',
    });
  }

  const db = getFirestore();
  const report = await runMultiProjectSchemaMigration(db, { dryRun });
  console.log(
    `[MIGRATION ${dryRun ? 'DRY-RUN' : 'COMPLETED'}] Normalized -> Orgs: ${report.organizationsNormalized}, Projects: ${report.projectsNormalized}, Units: ${report.unitsNormalized}, PriceBooks: ${report.priceBooksNormalized}`
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('[ERROR] Multi-project schema migration failed:', err);
    process.exit(1);
  });
}

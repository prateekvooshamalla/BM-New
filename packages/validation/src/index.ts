/**
 * @bharat-makaan/validation — Shared Global Multi-Project Zod Schemas for Web, Mobile & Cloud Functions
 */

import { z } from 'zod';
import {
  PERMISSIONS,
  PROJECT_STRUCTURE_TEMPLATE_KEYS,
  ROLES,
  SUPPORTED_AREA_UNITS,
  SUPPORTED_CURRENCY_CODES,
} from '@bharat-makaan/shared';

export const roleKeySchema = z.enum(ROLES);
export const permissionKeySchema = z.enum(PERMISSIONS);
export const currencyCodeSchema = z.enum(SUPPORTED_CURRENCY_CODES);
export const areaUnitSchema = z.enum(SUPPORTED_AREA_UNITS);
export const projectStructureTemplateSchema = z.enum(PROJECT_STRUCTURE_TEMPLATE_KEYS);

export const globalPhoneSchema = z
  .string()
  .min(7, 'Enter a valid phone number')
  .max(22, 'Phone number is too long')
  .regex(/^[+\d][\d\s()-]{6,21}$/, 'Invalid phone number format');

// Retained alias for backward compatibility across existing modules
export const indianPhoneSchema = globalPhoneSchema;

export const projectTypeSchema = z.enum([
  'APARTMENT',
  'VILLA',
  'INDEPENDENT_HOUSE',
  'PLOTTED',
  'COMMERCIAL',
  'OFFICE',
  'RETAIL',
  'MIXED',
  'RESALE_PORTFOLIO',
  'RENTAL_PORTFOLIO',
]);

export const unitTypeSchema = z.enum([
  'APARTMENT',
  'PENTHOUSE',
  'VILLA',
  'INDEPENDENT_HOUSE',
  'PLOT',
  'SHOP',
  'RETAIL_SPACE',
  'OFFICE',
  'COMMERCIAL_UNIT',
]);

export const towerTypeSchema = z.enum([
  'TOWER',
  'BLOCK',
  'BUILDING',
  'SECTOR',
  'VILLA_CLUSTER',
  'COMMUNITY',
  'RETAIL_WING',
]);

// --- Organization & Staff Management ---
export const createOrganizationSchema = z.object({
  name: z.string().min(2, 'Builder / Agency / Organization name is required').max(120),
  legalName: z.string().min(2, 'Registered legal name is required').max(160),
  organizationType: z
    .enum(['BUILDER', 'DEVELOPER', 'REAL_ESTATE_AGENCY', 'ENTERPRISE_GROUP'])
    .default('BUILDER'),
  countryCode: z.string().min(2).max(3).default('IN'),
  stateOrRegion: z.string().max(80).optional(),
  defaultCurrency: currencyCodeSchema.default('INR'),
  defaultAreaUnit: areaUnitSchema.default('SQFT'),
  defaultTimezone: z.string().max(80).default('Asia/Kolkata'),
  taxRegistrationLabel: z.string().max(40).optional(),
  taxRegistrationNumber: z.string().max(80).optional().or(z.literal('')),
  regulatoryAuthorityLabel: z.string().max(60).optional(),
  regulatoryRegistrationNumber: z.string().max(100).optional().or(z.literal('')),
  gstin: z
    .string()
    .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/, 'Invalid GSTIN format')
    .optional()
    .or(z.literal('')),
  pan: z
    .string()
    .regex(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, 'Invalid PAN format')
    .optional()
    .or(z.literal('')),
  reraNumber: z.string().max(100).optional().or(z.literal('')),
  headquartersCity: z.string().min(2, 'Headquarters city is required').max(80),
  address: z.string().max(300).optional(),
  phone: globalPhoneSchema.optional().or(z.literal('')),
  email: z.string().email('Valid official email required').optional().or(z.literal('')),
  leadProtectionDays: z.coerce.number().int().min(1).max(365).default(60),
});

export const updateOrganizationSettingsSchema = z.object({
  orgId: z.string().min(1),
  organizationType: z
    .enum(['BUILDER', 'DEVELOPER', 'REAL_ESTATE_AGENCY', 'ENTERPRISE_GROUP'])
    .optional(),
  countryCode: z.string().min(2).max(3).optional(),
  stateOrRegion: z.string().max(80).optional(),
  defaultCurrency: currencyCodeSchema.optional(),
  defaultAreaUnit: areaUnitSchema.optional(),
  defaultTimezone: z.string().max(80).optional(),
  taxRegistrationLabel: z.string().max(40).optional(),
  taxRegistrationNumber: z.string().max(80).optional(),
  regulatoryAuthorityLabel: z.string().max(60).optional(),
  regulatoryRegistrationNumber: z.string().max(100).optional(),
  leadProtectionDays: z.coerce.number().int().min(1).max(365).optional(),
  whatsappAutoSendAi: z.boolean().optional(),
  branding: z
    .object({
      primaryColor: z.string().max(20).optional(),
      accentColor: z.string().max(20).optional(),
      logoUrl: z.string().max(500).optional(),
      quotationFooterText: z.string().max(500).optional(),
    })
    .optional(),
  taxRegime: z
    .object({
      primaryTaxLabel: z.string().min(1).max(40),
      primaryTaxPct: z.coerce.number().min(0).max(100),
      secondaryTaxLabel: z.string().min(1).max(40),
      secondaryTaxPct: z.coerce.number().min(0).max(100),
      exemptLabel: z.string().min(1).max(40),
    })
    .optional(),
});

export const superAdminInspectOrganizationSchema = z.object({
  orgId: z.string().min(1),
  reason: z
    .string()
    .min(10, 'Explicit support/audit justification of at least 10 characters is required')
    .max(500),
});

export const inviteStaffMemberSchema = z.object({
  orgId: z.string().min(1),
  email: z.string().email('Enter a valid employee email address'),
  displayName: z.string().min(2, 'Employee name is required').max(100),
  phone: globalPhoneSchema.optional().or(z.literal('')),
  role: roleKeySchema,
  permissions: z.array(permissionKeySchema).min(1, 'Select at least one permission'),
  assignedProjectIds: z.array(z.string()).default([]),
  department: z.string().max(80).optional(),
  managerUid: z.string().optional(),
});

export const updateMemberAccessSchema = z.object({
  orgId: z.string().min(1),
  targetUid: z.string().min(1),
  role: roleKeySchema.optional(),
  permissions: z.array(permissionKeySchema).optional(),
  assignedProjectIds: z.array(z.string()).optional(),
  department: z.string().max(80).optional(),
  managerUid: z.string().nullable().optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'REVOKED']).optional(),
});

export const transferLeadsSchema = z.object({
  orgId: z.string().min(1),
  fromAgentUid: z.string().min(1, 'Source employee is required'),
  toAgentUid: z.string().min(1, 'Target employee is required'),
  projectId: z.string().optional(),
  reason: z.string().min(3, 'Transfer reason is required').max(250),
});

// --- Projects, Phases, Towers, Floors & Units ---
export const createProjectSchema = z.object({
  orgId: z.string().min(1),
  builderName: z.string().min(2, 'Builder / Agency brand name is required').max(120),
  name: z.string().min(2, 'Project name is required').max(120),
  code: z
    .string()
    .min(2, 'Project code is required')
    .max(20)
    .regex(/^[A-Z0-9_-]+$/i, 'Use alphanumeric characters, hyphens or underscores'),
  countryCode: z.string().min(2).max(3).default('IN'),
  stateOrRegion: z.string().max(80).optional(),
  city: z.string().min(2, 'City is required').max(80),
  locality: z.string().min(2, 'Locality / micro-market is required').max(120),
  address: z.string().min(5, 'Full project address is required').max(300),
  coordinates: z
    .object({
      lat: z.coerce.number().min(-90).max(90),
      lng: z.coerce.number().min(-180).max(180),
    })
    .optional(),
  currencyCode: currencyCodeSchema.optional(),
  areaUnit: areaUnitSchema.optional(),
  timezone: z.string().max(80).optional(),
  projectType: projectTypeSchema,
  structureTemplate: projectStructureTemplateSchema.optional(),
  hierarchyLabels: z
    .object({
      phaseLabel: z.string().min(1).max(40),
      structureLabel: z.string().min(1).max(40),
      floorLabel: z.string().min(1).max(40),
      unitLabel: z.string().min(1).max(40),
      requiresStructure: z.boolean(),
      requiresFloor: z.boolean(),
    })
    .optional(),
  regulatoryAuthorityLabel: z.string().max(60).optional(),
  reraNumber: z.string().min(2, 'Regulatory / permit registration ID is required').max(100),
  reraValidUntil: z.string().optional(),
  defaultCostSheetTemplateId: z.string().nullable().optional(),
  landAreaAcres: z.coerce.number().positive().optional(),
  configurations: z.array(z.string()).min(1, 'Specify at least one configuration'),
  amenities: z.array(z.string()).default([]),
  constructionStatus: z.enum([
    'PRE_LAUNCH',
    'NEW_LAUNCH',
    'UNDER_CONSTRUCTION',
    'NEARING_POSSESSION',
    'READY_TO_MOVE',
  ]),
  possessionDate: z.string().optional(),
  listingIntent: z.enum(['BUY', 'RENT', 'BOTH']).default('BUY'),
  isPublicPublished: z.boolean().default(false),
});

export const createPhaseSchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  name: z.string().min(2).max(80),
  code: z.string().min(1).max(20),
  sequence: z.coerce.number().int().min(1),
  reraNumber: z.string().max(100).optional(),
  constructionStatus: z.enum([
    'PRE_LAUNCH',
    'NEW_LAUNCH',
    'UNDER_CONSTRUCTION',
    'NEARING_POSSESSION',
    'READY_TO_MOVE',
  ]),
  possessionDate: z.string().optional(),
});

export const createTowerSchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  phaseId: z.string().nullable().optional(),
  name: z.string().min(1, 'Structure / Building / Sector name is required').max(80),
  code: z.string().min(1, 'Structure code is required').max(20),
  towerType: towerTypeSchema,
  totalFloors: z.coerce.number().int().min(0).max(200),
  basementLevels: z.coerce.number().int().min(0).max(15).default(1),
  podiumLevels: z.coerce.number().int().min(0).max(15).default(0),
  unitsPerFloorTypical: z.coerce.number().int().min(1).max(100).default(4),
});

export const createFloorSchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  phaseId: z.string().nullable().optional(),
  towerId: z.string().min(1),
  floorNumber: z.coerce.number().int().min(-15).max(200),
  label: z.string().min(1).max(60),
  floorCategory: z.enum([
    'PODIUM',
    'LOWER_RESIDENTIAL',
    'TYPICAL',
    'PENTHOUSE',
    'REFUGE',
    'COMMERCIAL',
    'GROUND_PLOT',
  ]),
});

export const createUnitSchema = z
  .object({
    orgId: z.string().min(1),
    projectId: z.string().min(1),
    phaseId: z.string().nullable().optional(),
    towerId: z.string().nullable().optional(),
    towerName: z.string().optional(),
    floorId: z.string().nullable().optional(),
    floorNumber: z.coerce.number().int().min(-10).max(200).default(0),
    unitNumber: z.string().min(1, 'Unit / Villa / Plot / Office identifier is required').max(40),
    unitType: unitTypeSchema,
    inventorySource: z
      .enum(['PRIMARY_DEVELOPER', 'RESALE', 'RENTAL_MANAGED'])
      .default('PRIMARY_DEVELOPER'),
    bhk: z.string().min(1, 'Configuration / Layout type is required').max(40),
    currencyCode: currencyCodeSchema.optional(),
    areaUnit: areaUnitSchema.optional(),
    primaryArea: z.coerce.number().positive().optional(),
    secondaryArea: z.coerce.number().positive().optional(),
    saleableAreaSqft: z.coerce.number().positive('Primary / Saleable area must be positive'),
    carpetAreaSqft: z.coerce.number().positive('Carpet / Net usable area must be positive'),
    plotAreaSqft: z.coerce.number().positive().optional(),
    facing: z.enum([
      'EAST',
      'WEST',
      'NORTH',
      'SOUTH',
      'NORTH_EAST',
      'NORTH_WEST',
      'SOUTH_EAST',
      'SOUTH_WEST',
    ]),
    viewType: z.string().max(60).optional(),
    isCorner: z.boolean().default(false),
    balconiesCount: z.coerce.number().int().min(0).max(20).default(1),
    parkingEntitlementCount: z.coerce.number().int().min(0).max(50).default(1),
    pricingMode: z.enum(['PER_AREA', 'BASE_UNIT_PRICE']).default('PER_AREA'),
    baseUnitPrice: z.coerce.number().nonnegative().optional(),
    baseRatePerSqft: z.coerce.number().nonnegative('Base rate must be >= 0'),
    listingMode: z.enum(['BUY', 'RENT', 'LEASE']).default('BUY'),
    monthlyRentInr: z.coerce.number().nonnegative().optional(),
    isPublicPublished: z.boolean().default(false),
  })
  .refine((u) => u.carpetAreaSqft <= u.saleableAreaSqft, {
    message: 'Usable / carpet area cannot exceed primary / saleable area',
    path: ['carpetAreaSqft'],
  });

export const unitStatusTransitionSchema = z.object({
  orgId: z.string().min(1),
  unitId: z.string().min(1),
  targetStatus: z.enum([
    'AVAILABLE',
    'ON_HOLD',
    'RESERVED',
    'BOOKED',
    'AGREEMENT',
    'REGISTERED',
  ]),
  action: z.enum([
    'HOLD',
    'RESERVE',
    'BOOK',
    'EXECUTE_AGREEMENT',
    'REGISTER',
    'RELEASE',
    'CANCEL',
    'EXPIRE',
  ]),
  holdDurationHours: z.coerce.number().int().min(1).max(720).optional(),
  leadId: z.string().optional(),
  reason: z.string().max(300).optional(),
});

// --- Physical Parking ---
export const createParkingSlotSchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  towerId: z.string().nullable().optional(),
  levelType: z.enum(['BASEMENT', 'PODIUM', 'SURFACE', 'STILT']),
  levelName: z.string().min(1, 'Level code (e.g. B1, P1) is required').max(30),
  zone: z.string().min(1, 'Zone is required').max(40),
  slotNumber: z.string().min(1, 'Slot number is required').max(30),
  parkingType: z.enum(['STANDARD', 'TANDEM', 'MECHANICAL', 'EV', 'ACCESSIBLE']),
  priceInr: z.coerce.number().nonnegative(),
});

export const allocateParkingSlotSchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  slotId: z.string().min(1),
  unitId: z.string().min(1),
  bookingId: z.string().optional(),
  reason: z.string().min(2).max(200),
});

export const swapParkingSlotsSchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  currentSlotId: z.string().min(1),
  targetSlotId: z.string().min(1),
  unitId: z.string().min(1),
  reason: z.string().min(3, 'Swap reason is required').max(200),
});

// --- Dynamic Global Pricing Engine & Cost-Sheet Templates ---
export const promotionalOfferRuleSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(2).max(40),
  label: z.string().min(2).max(120),
  offerType: z.enum([
    'PERCENTAGE_REBATE',
    'FIXED_REBATE',
    'FLOOR_RISE_WAIVER',
    'PARKING_WAIVER',
  ]),
  value: z.coerce.number().nonnegative(),
  isActive: z.boolean().default(true),
  validUntil: z.string().nullable().optional(),
});

export const costSheetLineItemRuleSchema = z.object({
  id: z.string().min(1),
  internalKey: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9_]+$/, 'Internal key must be lowercase snake_case'),
  displayLabel: z.string().min(2, 'Line item label is required').max(140),
  description: z.string().max(250).optional(),
  basis: z.enum([
    'PER_SQFT_SALEABLE',
    'PER_SQFT_CARPET',
    'PER_PRIMARY_AREA',
    'PER_SECONDARY_AREA',
    'FIXED_AMOUNT',
    'PERCENTAGE_OF_BASE',
  ]),
  amount: z.coerce.number().nonnegative(),
  taxCategory: z.enum([
    'AGREEMENT_GST',
    'OTHER_SERVICE_GST',
    'EXEMPT_CORPUS',
    'PRIMARY_TAX',
    'SECONDARY_TAX',
    'EXEMPT',
  ]),
  applicableUnitTypes: z.array(unitTypeSchema).optional(),
  applicableBhk: z.array(z.string()).optional(),
  isOptional: z.boolean().default(false),
  isVisible: z.boolean().default(true),
  isRemovable: z.boolean().default(true),
  displayOrder: z.coerce.number().int().min(1).max(100),
});

export const upsertPriceBookSchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  priceBookId: z.string().optional(),
  name: z.string().min(2, 'Price book name is required').max(120),
  description: z.string().max(400).optional(),
  effectiveFrom: z.string().min(1, 'Effective date is required'),
  expiresAt: z.string().nullable().optional(),
  currencyCode: currencyCodeSchema.optional(),
  areaUnit: areaUnitSchema.optional(),
  pricingMode: z.enum(['PER_AREA', 'BASE_UNIT_PRICE']).optional(),
  baseUnitPrice: z.coerce.number().nonnegative().optional(),
  baseConsiderationLabel: z.string().max(120).optional(),
  floorRiseLabel: z.string().max(120).optional(),
  parkingLabel: z.string().max(120).optional(),
  basePricePerSqft: z.coerce.number().nonnegative('Base price per area unit must be >= 0'),
  floorRise: z.object({
    enabled: z.boolean(),
    startFloor: z.coerce.number().int().min(0).max(200),
    ratePerFloorPerSqft: z.coerce.number().nonnegative(),
  }),
  facingPremiumPerSqft: z.record(z.string(), z.coerce.number().nonnegative()).default({}),
  viewPremiumPerSqft: z.record(z.string(), z.coerce.number().nonnegative()).default({}),
  cornerPremiumPerSqft: z.coerce.number().nonnegative().default(0),
  locationPremiumPerSqft: z.coerce.number().nonnegative().default(0),
  unitSpecificPremiumInr: z.record(z.string(), z.coerce.number().nonnegative()).default({}),
  parkingPricesByType: z.object({
    STANDARD: z.coerce.number().nonnegative(),
    TANDEM: z.coerce.number().nonnegative(),
    MECHANICAL: z.coerce.number().nonnegative(),
    EV: z.coerce.number().nonnegative(),
    ACCESSIBLE: z.coerce.number().nonnegative(),
  }),
  lineItems: z.array(costSheetLineItemRuleSchema),
  taxConfig: z.object({
    agreementGstPct: z.coerce.number().min(0).max(100),
    otherServiceGstPct: z.coerce.number().min(0).max(100),
    primaryTaxLabel: z.string().max(60).optional(),
    secondaryTaxLabel: z.string().max(60).optional(),
    exemptTaxLabel: z.string().max(60).optional(),
    roundingMode: z.enum(['NEAREST_RUPEE', 'EXACT_PAISE', 'NEAREST_UNIT', 'MINOR_UNIT']),
    registrationDisclaimer: z.string().min(5).max(500),
  }),
  offers: z.array(promotionalOfferRuleSchema).optional(),
  maxDiscountPctWithoutApproval: z.coerce.number().min(0).max(100).default(2),
  defaultPaymentPlanId: z.string().nullable().optional(),
  internalNotes: z.string().max(1000).optional(),
});

export const savePricingScopeOverrideSchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().nullable().optional(),
  overrideId: z.string().optional(),
  scopeLevel: z.enum(['ORGANIZATION', 'PROJECT', 'PHASE', 'STRUCTURE', 'UNIT_TYPE', 'UNIT']),
  targetId: z.string().min(1, 'Target scope identifier is required'),
  label: z.string().max(120).optional(),
  isActive: z.boolean().default(true),
  effectiveFrom: z.string().min(1),
  currencyCode: currencyCodeSchema.optional(),
  areaUnit: areaUnitSchema.optional(),
  pricingMode: z.enum(['PER_AREA', 'BASE_UNIT_PRICE']).optional(),
  basePricePerArea: z.coerce.number().nonnegative().optional(),
  baseUnitPrice: z.coerce.number().nonnegative().optional(),
  baseConsiderationLabel: z.string().max(120).optional(),
  floorRise: z
    .object({
      enabled: z.boolean().optional(),
      startFloor: z.coerce.number().int().min(0).max(200).optional(),
      ratePerFloorPerSqft: z.coerce.number().nonnegative().optional(),
    })
    .optional(),
  facingPremiumPerSqft: z.record(z.string(), z.coerce.number().nonnegative()).optional(),
  viewPremiumPerSqft: z.record(z.string(), z.coerce.number().nonnegative()).optional(),
  cornerPremiumPerSqft: z.coerce.number().nonnegative().optional(),
  locationPremiumPerSqft: z.coerce.number().nonnegative().optional(),
  parkingPricesByType: z.record(z.string(), z.coerce.number().nonnegative()).optional(),
  lineItemsOverride: z.array(costSheetLineItemRuleSchema).optional(),
  taxConfigOverride: z
    .object({
      agreementGstPct: z.coerce.number().min(0).max(100).optional(),
      otherServiceGstPct: z.coerce.number().min(0).max(100).optional(),
      primaryTaxLabel: z.string().max(60).optional(),
      secondaryTaxLabel: z.string().max(60).optional(),
      exemptTaxLabel: z.string().max(60).optional(),
      roundingMode: z
        .enum(['NEAREST_RUPEE', 'EXACT_PAISE', 'NEAREST_UNIT', 'MINOR_UNIT'])
        .optional(),
      registrationDisclaimer: z.string().max(500).optional(),
    })
    .optional(),
  maxDiscountPctWithoutApproval: z.coerce.number().min(0).max(100).optional(),
  offers: z.array(promotionalOfferRuleSchema).optional(),
});

export const upsertCostSheetTemplateSchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().nullable().optional(),
  templateId: z.string().optional(),
  name: z.string().min(2, 'Template name is required').max(120),
  code: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[A-Z0-9_-]+$/i, 'Use alphanumeric characters, hyphens or underscores'),
  isDefault: z.boolean().default(false),
  headerConfig: z.object({
    title: z.string().min(2).max(140),
    subtitle: z.string().max(200).optional(),
    showOrgLogo: z.boolean().default(true),
    showRegulatoryNumber: z.boolean().default(true),
    accentColor: z.string().default('#0F265C'),
  }),
  sectionToggles: z.object({
    showCustomerSection: z.boolean().default(true),
    showUnitSection: z.boolean().default(true),
    showAreaBreakdown: z.boolean().default(true),
    showParkingBreakdown: z.boolean().default(true),
    showTaxBreakdown: z.boolean().default(true),
    showOfferRebates: z.boolean().default(true),
    showPaymentSchedule: z.boolean().default(true),
    showTerms: z.boolean().default(true),
    showSalesRepSection: z.boolean().default(true),
    showSignatureBlocks: z.boolean().default(true),
  }),
  customLabels: z.object({
    unitSectionTitle: z.string().min(1).max(80).default('Unit & Property Specifications'),
    customerSectionTitle: z.string().min(1).max(80).default('Prospective Buyer Details'),
    pricingTableTitle: z.string().min(1).max(80).default('Detailed Consideration & Charge Breakdown'),
    primaryTaxSummaryLabel: z.string().min(1).max(80).default('Primary Agreement Tax'),
    secondaryTaxSummaryLabel: z.string().min(1).max(80).default('Service & Ancillary Tax'),
    exemptSummaryLabel: z.string().min(1).max(80).default('Exempt / Deposit Charges'),
    netConsiderationLabel: z.string().min(1).max(80).default('Net Consideration Before Tax'),
    grandTotalLabel: z.string().min(1).max(80).default('Total Payable Value'),
    scheduleSectionTitle: z.string().min(1).max(80).default('Payment Schedule'),
  }),
  defaultTermsAndConditions: z.string().min(5).max(4000),
  footerText: z.string().max(400).default('System-generated official quotation.'),
});

// --- Payment Plans & Quotations ---
export const paymentPlanSchema = z
  .object({
    orgId: z.string().min(1),
    projectId: z.string().min(1),
    name: z.string().min(2).max(120),
    planType: z.enum(['CONSTRUCTION_LINKED', 'DATE_LINKED', 'DOWN_PAYMENT', 'CUSTOM']),
    milestones: z
      .array(
        z.object({
          sequence: z.coerce.number().int().min(1),
          name: z.string().min(2).max(120),
          description: z.string().max(250).optional(),
          percentage: z.coerce.number().positive().max(100),
          dueTrigger: z.string().min(2).max(160),
          estimatedDate: z.string().optional(),
          taxTreatment: z.enum(['PROPORTIONAL_GST', 'INCLUDE_POSSESSION_CHARGES']),
          notes: z.string().max(250).optional(),
        })
      )
      .min(1, 'Add at least one payment milestone'),
  })
  .refine(
    (plan) => {
      const sum = plan.milestones.reduce((acc, m) => acc + m.percentage, 0);
      return Math.abs(sum - 100) < 0.001;
    },
    {
      message: 'Milestone percentages must sum to exactly 100%',
      path: ['milestones'],
    }
  );

export const createQuotationSchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  unitId: z.string().min(1),
  priceBookId: z.string().min(1),
  paymentPlanId: z.string().min(1),
  costSheetTemplateId: z.string().nullable().optional(),
  offerCodes: z.array(z.string()).default([]),
  leadId: z.string().nullable().optional(),
  partnerOrgId: z.string().nullable().optional(),
  customer: z.object({
    name: z.string().min(2, 'Customer name is required').max(120),
    phone: globalPhoneSchema,
    email: z.string().email().optional().or(z.literal('')),
    address: z.string().max(300).optional(),
  }),
  selectedParkingSlotIds: z.array(z.string()).default([]),
  parkingSlotsCount: z.coerce.number().int().min(0).max(50).default(1),
  parkingTypeUsed: z
    .enum(['STANDARD', 'TANDEM', 'MECHANICAL', 'EV', 'ACCESSIBLE'])
    .default('STANDARD'),
  discount: z.object({
    type: z.enum(['NONE', 'FIXED_INR', 'PER_SQFT', 'PERCENTAGE_OF_BASE']).default('NONE'),
    value: z.coerce.number().nonnegative().default(0),
    reason: z.string().max(250).optional(),
  }),
  validDays: z.coerce.number().int().min(1).max(90).default(15),
  termsAndConditions: z.string().min(10).max(4000),
});

// --- Leads, Partner Registration, Visits & Forms ---
export const createLeadSchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().nullable().optional(),
  currencyCode: currencyCodeSchema.optional(),
  customerName: z.string().min(2, 'Customer name is required').max(120),
  phone: globalPhoneSchema,
  email: z.string().email().optional().or(z.literal('')),
  source: z.enum([
    'WEBSITE',
    'PUBLIC_PORTAL',
    'FACEBOOK_ADS',
    'INSTAGRAM_ADS',
    'INSTAGRAM_DM',
    'MESSENGER',
    'WHATSAPP',
    'GOOGLE_ADS',
    'CHANNEL_PARTNER',
    'CSV_IMPORT',
    'MANUAL',
    'HOSTED_FORM',
    'WEBHOOK',
  ]),
  campaign: z.string().max(120).optional(),
  budgetMinInr: z.coerce.number().nonnegative().optional(),
  budgetMaxInr: z.coerce.number().nonnegative().optional(),
  preferredLocation: z.string().max(120).optional(),
  preferredProjectIds: z.array(z.string()).default([]),
  bhkPreference: z.string().max(40).optional(),
  propertyType: projectTypeSchema.optional(),
  buyingTimeline: z
    .enum(['IMMEDIATE', '1_TO_3_MONTHS', '3_TO_6_MONTHS', '6_PLUS_MONTHS'])
    .optional(),
  assignedAgentUid: z.string().optional(),
  partnerOrgId: z.string().optional(),
  whatsappOptIn: z.boolean().default(true),
  notes: z.string().max(1000).optional(),
});

export const registerPartnerLeadSchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  partnerOrgId: z.string().min(1),
  customerName: z.string().min(2).max(120),
  phone: globalPhoneSchema,
  email: z.string().email().optional().or(z.literal('')),
  budgetMaxInr: z.coerce.number().nonnegative().optional(),
  bhkPreference: z.string().max(40).optional(),
  notes: z.string().max(500).optional(),
});

export const scheduleSiteVisitSchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  unitId: z.string().nullable().optional(),
  leadId: z.string().nullable().optional(),
  partnerOrgId: z.string().nullable().optional(),
  customerName: z.string().min(2, 'Visitor name is required').max(120),
  customerPhone: globalPhoneSchema,
  customerEmail: z.string().email().optional().or(z.literal('')),
  assignedAgentUid: z.string().nullable().optional(),
  scheduledStartAt: z.string().min(1, 'Visit start date/time is required'),
  scheduledEndAt: z.string().min(1, 'Visit end date/time is required'),
  timezone: z.string().default('UTC'),
  notes: z.string().max(500).optional(),
});

// --- Bookings & Collections ---
export const createBookingSchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  unitId: z.string().min(1),
  quotationId: z.string().min(1, 'An approved/issued quotation must be linked'),
  leadId: z.string().min(1),
  partnerOrgId: z.string().nullable().optional(),
  customer: z.object({
    fullName: z.string().min(2, 'Applicant full name is required').max(120),
    coApplicantName: z.string().max(120).optional(),
    phone: globalPhoneSchema,
    email: z.string().email('Valid customer email is required'),
    panNumber: z
      .string()
      .regex(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, 'Enter valid 10-character PAN')
      .optional()
      .or(z.literal('')),
    aadhaarLast4: z
      .string()
      .regex(/^\d{4}$/, 'Enter last 4 digits only')
      .optional()
      .or(z.literal('')),
    permanentAddress: z.string().min(5, 'Permanent address is required').max(350),
  }),
  allocatedParkingSlotIds: z.array(z.string()).default([]),
  tokenAmountExpectedInr: z.coerce.number().positive('Token amount must be > 0'),
});

export const recordCollectionSchema = z.object({
  orgId: z.string().min(1),
  bookingId: z.string().min(1),
  recordType: z.enum(['TOKEN', 'MILESTONE_DEMAND', 'RECEIPT', 'PARTIAL_PAYMENT', 'REFUND']),
  milestoneSequence: z.coerce.number().int().min(1).optional(),
  milestoneName: z.string().min(2).max(120),
  demandAmountInr: z.coerce.number().nonnegative(),
  paidAmountInr: z.coerce.number().nonnegative(),
  paymentMode: z.enum(['RAZORPAY', 'NEFT', 'RTGS', 'IMPS', 'CHEQUE', 'DD']),
  instrumentRef: z.string().max(100).optional(),
  dueDate: z.string().optional(),
  notes: z.string().max(500).optional(),
});

// --- Lead Capture Form Builder ---
export const upsertLeadFormSchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().nullable().optional(),
  formId: z.string().optional(),
  name: z.string().min(2).max(120),
  slug: z
    .string()
    .min(3)
    .max(80)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).default('DRAFT'),
  fields: z
    .array(
      z.object({
        id: z.string().min(1),
        type: z.enum([
          'TEXT',
          'NUMBER',
          'PHONE',
          'EMAIL',
          'DROPDOWN',
          'CHECKBOX',
          'RADIO',
          'DATE',
          'BUDGET',
          'PROPERTY_INTEREST',
          'PROJECT_SELECTOR',
          'BHK',
        ]),
        label: z.string().min(1).max(120),
        placeholder: z.string().max(120).optional(),
        required: z.boolean().default(false),
        options: z.array(z.string()).optional(),
        condition: z
          .object({
            dependsOnFieldId: z.string(),
            equalsValue: z.string(),
          })
          .optional(),
        order: z.coerce.number().int().min(0),
      })
    )
    .min(1, 'Form must include at least one field'),
  branding: z.object({
    headline: z.string().min(2).max(140),
    description: z.string().max(300).optional(),
    accentColor: z.string().default('#0F265C'),
    logoUrl: z.string().optional(),
  }),
  consentText: z.string().min(10, 'Explicit privacy/contact consent text is required').max(400),
  successMessage: z.string().min(3).max(250),
  honeypotEnabled: z.boolean().default(true),
  rateLimitPerHour: z.coerce.number().int().min(5).max(5000).default(120),
});

export const publicFormSubmissionSchema = z.object({
  formSlug: z.string().min(2),
  values: z.record(z.string(), z.unknown()),
  consentAccepted: z.literal(true, {
    errorMap: () => ({ message: 'You must accept the consent terms to submit' }),
  }),
  honeypotValue: z.string().max(0, 'Bot submission rejected').optional().default(''),
});

// --- Documents & Floor Plans ---
export const registerDocumentMetadataSchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().nullable().optional(),
  towerId: z.string().nullable().optional(),
  floorId: z.string().nullable().optional(),
  unitId: z.string().nullable().optional(),
  category: z.enum([
    'MASTER_PLAN',
    'TOWER_PLAN',
    'FLOOR_PLAN',
    'UNIT_LAYOUT',
    'BROCHURE',
    'PRICE_SHEET',
    'RERA_DOC',
    'APPROVAL_FILE',
    'COST_SHEET',
    'BOOKING_DOC',
    'PAYMENT_RECEIPT',
  ]),
  title: z.string().min(2).max(140),
  fileName: z.string().min(1).max(180),
  mimeType: z.enum([
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
  ]),
  sizeBytes: z.coerce.number().int().positive().max(25 * 1024 * 1024, 'Max file size is 25 MB'),
  storagePath: z.string().min(5),
  visibility: z.enum(['INTERNAL', 'PARTNER', 'CUSTOMER', 'PUBLIC']).default('INTERNAL'),
  watermarkEnabled: z.boolean().default(false),
});

export const mapFloorPlanVersionSchema = z
  .object({
    orgId: z.string().min(1),
    documentId: z.string().min(1),
    projectId: z.string().min(1),
    towerIds: z.array(z.string()).default([]), // Empty allowed for Villa/Plot non-tower projects
    floorCategory: z.enum([
      'PODIUM',
      'LOWER_RESIDENTIAL',
      'TYPICAL',
      'PENTHOUSE',
      'REFUGE',
      'COMMERCIAL',
      'GROUND_PLOT',
    ]),
    minFloor: z.coerce.number().int().min(-10).max(200),
    maxFloor: z.coerce.number().int().min(-10).max(200),
    applicableUnitTypes: z.array(unitTypeSchema).min(1),
    applicableBhk: z.array(z.string()).min(1),
    carpetAreaSqft: z.coerce.number().positive(),
    saleableAreaSqft: z.coerce.number().positive(),
    storagePath: z.string().min(5),
    fileName: z.string().min(1),
  })
  .refine((fp) => fp.minFloor <= fp.maxFloor, {
    message: 'Minimum floor cannot exceed maximum floor',
    path: ['minFloor'],
  });

// --- Approval Decision ---
export const decideApprovalSchema = z.object({
  orgId: z.string().min(1),
  approvalId: z.string().min(1),
  decision: z.enum(['APPROVED', 'REJECTED']),
  decisionNotes: z.string().min(2, 'Decision notes are required').max(500),
});

export * from './ai-assistant';
export * from './billing-auth';

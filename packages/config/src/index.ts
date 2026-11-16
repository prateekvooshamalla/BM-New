/**
 * @bharat-makaan/config
 * Centralized brand identity, design system tokens, navigation contracts,
 * and configurable SaaS plan defaults shared across Web, Mobile, and Backend.
 */

export const BRAND_CONFIG = {
  name: 'Bharat Makaan',
  legalEntity: 'Bharat Makaan Technologies',
  positioning: 'AI-powered real estate management for builders, agents and channel partners.',
  promise:
    'Manage properties, projects, towers, apartments, pricing, bookings, leads and channel partners from one intelligent platform.',
  heroHeadline: 'Find Your Next Property. Manage Real Estate with AI.',
  heroSubheadline:
    'Explore properties, connect with trusted agents and book site visits. For real estate professionals, manage listings, inventory, leads and sales with one intelligent platform.',
  defaultTimezone: 'Asia/Kolkata',
  defaultCurrency: 'INR',
  defaultAreaUnit: 'SQFT',
  defaultCountryCode: 'IN',
  defaultLocale: 'en-IN',
  initialSuperAdminEmail: 'prateek.parts@gmail.com',
} as const;

export const SUPPORTED_CURRENCY_CODES = [
  'INR',
  'AED',
  'USD',
  'GBP',
  'EUR',
  'SGD',
  'AUD',
  'CAD',
  'JPY',
  'KWD',
] as const;

export type CurrencyCode = (typeof SUPPORTED_CURRENCY_CODES)[number];

export interface CurrencyConfig {
  code: CurrencyCode;
  symbol: string;
  name: string;
  locale: string;
  minorUnitDigits: 0 | 2 | 3;
}

export const CURRENCY_CONFIGS: Record<CurrencyCode, CurrencyConfig> = {
  INR: { code: 'INR', symbol: '₹', name: 'Indian Rupee', locale: 'en-IN', minorUnitDigits: 2 },
  AED: { code: 'AED', symbol: 'AED ', name: 'UAE Dirham', locale: 'en-AE', minorUnitDigits: 2 },
  USD: { code: 'USD', symbol: '$', name: 'US Dollar', locale: 'en-US', minorUnitDigits: 2 },
  GBP: { code: 'GBP', symbol: '£', name: 'British Pound', locale: 'en-GB', minorUnitDigits: 2 },
  EUR: { code: 'EUR', symbol: '€', name: 'Euro', locale: 'de-DE', minorUnitDigits: 2 },
  SGD: { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar', locale: 'en-SG', minorUnitDigits: 2 },
  AUD: { code: 'AUD', symbol: 'A$', name: 'Australian Dollar', locale: 'en-AU', minorUnitDigits: 2 },
  CAD: { code: 'CAD', symbol: 'CA$', name: 'Canadian Dollar', locale: 'en-CA', minorUnitDigits: 2 },
  JPY: { code: 'JPY', symbol: '¥', name: 'Japanese Yen', locale: 'ja-JP', minorUnitDigits: 0 },
  KWD: { code: 'KWD', symbol: 'KD ', name: 'Kuwaiti Dinar', locale: 'en-KW', minorUnitDigits: 3 },
};

export const SUPPORTED_AREA_UNITS = ['SQFT', 'SQM', 'SQYD', 'ACRE', 'HECTARE'] as const;
export type AreaUnitCode = (typeof SUPPORTED_AREA_UNITS)[number];

export interface AreaUnitConfig {
  code: AreaUnitCode;
  label: string;
  shortLabel: string;
  toSqftFactor: number;
}

export const AREA_UNIT_CONFIGS: Record<AreaUnitCode, AreaUnitConfig> = {
  SQFT: { code: 'SQFT', label: 'Square Feet', shortLabel: 'sq. ft.', toSqftFactor: 1 },
  SQM: { code: 'SQM', label: 'Square Meters', shortLabel: 'sq. m.', toSqftFactor: 10.7639 },
  SQYD: { code: 'SQYD', label: 'Square Yards', shortLabel: 'sq. yd.', toSqftFactor: 9 },
  ACRE: { code: 'ACRE', label: 'Acres', shortLabel: 'acres', toSqftFactor: 43560 },
  HECTARE: { code: 'HECTARE', label: 'Hectares', shortLabel: 'ha', toSqftFactor: 107639.1 },
};

export interface GlobalCountryConfig {
  code: string;
  name: string;
  callingCode: string;
  defaultCurrency: CurrencyCode;
  defaultAreaUnit: AreaUnitCode;
  defaultTimezone: string;
  regulatoryAuthorityLabel: string;
  primaryTaxLabel: string;
  secondaryTaxLabel: string;
  defaultPrimaryTaxPct: number;
  defaultSecondaryTaxPct: number;
}

export const GLOBAL_COUNTRIES: Record<string, GlobalCountryConfig> = {
  IN: {
    code: 'IN',
    name: 'India',
    callingCode: '+91',
    defaultCurrency: 'INR',
    defaultAreaUnit: 'SQFT',
    defaultTimezone: 'Asia/Kolkata',
    regulatoryAuthorityLabel: 'RERA Registration',
    primaryTaxLabel: 'GST',
    secondaryTaxLabel: 'Service GST',
    defaultPrimaryTaxPct: 5,
    defaultSecondaryTaxPct: 18,
  },
  AE: {
    code: 'AE',
    name: 'United Arab Emirates',
    callingCode: '+971',
    defaultCurrency: 'AED',
    defaultAreaUnit: 'SQFT',
    defaultTimezone: 'Asia/Dubai',
    regulatoryAuthorityLabel: 'DLD / RERA Permit',
    primaryTaxLabel: 'VAT',
    secondaryTaxLabel: 'Service VAT',
    defaultPrimaryTaxPct: 0,
    defaultSecondaryTaxPct: 5,
  },
  US: {
    code: 'US',
    name: 'United States',
    callingCode: '+1',
    defaultCurrency: 'USD',
    defaultAreaUnit: 'SQFT',
    defaultTimezone: 'America/New_York',
    regulatoryAuthorityLabel: 'Subdivision / State License ID',
    primaryTaxLabel: 'Transfer Tax',
    secondaryTaxLabel: 'Service Tax',
    defaultPrimaryTaxPct: 1.5,
    defaultSecondaryTaxPct: 0,
  },
  GB: {
    code: 'GB',
    name: 'United Kingdom',
    callingCode: '+44',
    defaultCurrency: 'GBP',
    defaultAreaUnit: 'SQFT',
    defaultTimezone: 'Europe/London',
    regulatoryAuthorityLabel: 'NHBC / Council Planning Ref',
    primaryTaxLabel: 'SDLT / VAT',
    secondaryTaxLabel: 'Service VAT',
    defaultPrimaryTaxPct: 0,
    defaultSecondaryTaxPct: 20,
  },
  SG: {
    code: 'SG',
    name: 'Singapore',
    callingCode: '+65',
    defaultCurrency: 'SGD',
    defaultAreaUnit: 'SQFT',
    defaultTimezone: 'Asia/Singapore',
    regulatoryAuthorityLabel: 'URA Developer License',
    primaryTaxLabel: 'BSD / GST',
    secondaryTaxLabel: 'GST',
    defaultPrimaryTaxPct: 9,
    defaultSecondaryTaxPct: 9,
  },
  AU: {
    code: 'AU',
    name: 'Australia',
    callingCode: '+61',
    defaultCurrency: 'AUD',
    defaultAreaUnit: 'SQM',
    defaultTimezone: 'Australia/Sydney',
    regulatoryAuthorityLabel: 'Development Approval (DA)',
    primaryTaxLabel: 'GST',
    secondaryTaxLabel: 'Service GST',
    defaultPrimaryTaxPct: 10,
    defaultSecondaryTaxPct: 10,
  },
  CA: {
    code: 'CA',
    name: 'Canada',
    callingCode: '+1',
    defaultCurrency: 'CAD',
    defaultAreaUnit: 'SQFT',
    defaultTimezone: 'America/Toronto',
    regulatoryAuthorityLabel: 'HCRA / Tarion Registration',
    primaryTaxLabel: 'GST / HST',
    secondaryTaxLabel: 'Service HST',
    defaultPrimaryTaxPct: 5,
    defaultSecondaryTaxPct: 13,
  },
  DE: {
    code: 'DE',
    name: 'Germany',
    callingCode: '+49',
    defaultCurrency: 'EUR',
    defaultAreaUnit: 'SQM',
    defaultTimezone: 'Europe/Berlin',
    regulatoryAuthorityLabel: 'MaBV / Handelsregister',
    primaryTaxLabel: 'GrESt / MwSt',
    secondaryTaxLabel: 'MwSt',
    defaultPrimaryTaxPct: 6,
    defaultSecondaryTaxPct: 19,
  },
  JP: {
    code: 'JP',
    name: 'Japan',
    callingCode: '+81',
    defaultCurrency: 'JPY',
    defaultAreaUnit: 'SQM',
    defaultTimezone: 'Asia/Tokyo',
    regulatoryAuthorityLabel: 'MLIT Real Estate License',
    primaryTaxLabel: 'Consumption Tax',
    secondaryTaxLabel: 'Service Tax',
    defaultPrimaryTaxPct: 10,
    defaultSecondaryTaxPct: 10,
  },
  KW: {
    code: 'KW',
    name: 'Kuwait',
    callingCode: '+965',
    defaultCurrency: 'KWD',
    defaultAreaUnit: 'SQM',
    defaultTimezone: 'Asia/Kuwait',
    regulatoryAuthorityLabel: 'MOCI / Municipality Permit',
    primaryTaxLabel: 'Registration Fee',
    secondaryTaxLabel: 'Service Charge Tax',
    defaultPrimaryTaxPct: 0.5,
    defaultSecondaryTaxPct: 0,
  },
};

export const PROJECT_STRUCTURE_TEMPLATE_KEYS = [
  'APARTMENT_TOWER',
  'VILLA_COMMUNITY',
  'PLOTTED_LAYOUT',
  'COMMERCIAL_BUILDING',
  'CUSTOM_HIERARCHY',
] as const;

export type ProjectStructureTemplateKey = (typeof PROJECT_STRUCTURE_TEMPLATE_KEYS)[number];

export interface ProjectStructureTemplateDefinition {
  key: ProjectStructureTemplateKey;
  name: string;
  description: string;
  requiresPhase: boolean;
  requiresStructure: boolean;
  requiresFloor: boolean;
  hierarchyLabels: {
    phaseLabel: string;
    structureLabel: string;
    floorLabel: string;
    unitLabel: string;
  };
}

export const PROJECT_STRUCTURE_TEMPLATES: Record<
  ProjectStructureTemplateKey,
  ProjectStructureTemplateDefinition
> = {
  APARTMENT_TOWER: {
    key: 'APARTMENT_TOWER',
    name: 'Apartment Project (Phase → Tower/Block → Floor → Unit)',
    description: 'Multi-storey residential towers or blocks with floor matrices and apartment units.',
    requiresPhase: false,
    requiresStructure: true,
    requiresFloor: true,
    hierarchyLabels: {
      phaseLabel: 'Phase',
      structureLabel: 'Tower / Block',
      floorLabel: 'Floor',
      unitLabel: 'Apartment / Unit',
    },
  },
  VILLA_COMMUNITY: {
    key: 'VILLA_COMMUNITY',
    name: 'Villa / Independent House Project (Phase/Community → Villa)',
    description: 'Gated villa communities, row houses or independent homes without apartment towers.',
    requiresPhase: false,
    requiresStructure: false,
    requiresFloor: false,
    hierarchyLabels: {
      phaseLabel: 'Phase / Community',
      structureLabel: 'Cluster / Enclave',
      floorLabel: 'Level',
      unitLabel: 'Villa / House',
    },
  },
  PLOTTED_LAYOUT: {
    key: 'PLOTTED_LAYOUT',
    name: 'Plotted Development (Phase/Sector → Plot)',
    description: 'Land layouts, sectors and residential or industrial plots without vertical floors.',
    requiresPhase: false,
    requiresStructure: false,
    requiresFloor: false,
    hierarchyLabels: {
      phaseLabel: 'Phase / Sector',
      structureLabel: 'Sector / Pocket',
      floorLabel: 'Ground',
      unitLabel: 'Plot',
    },
  },
  COMMERCIAL_BUILDING: {
    key: 'COMMERCIAL_BUILDING',
    name: 'Commercial Project (Phase → Building → Floor → Office/Shop/Unit)',
    description: 'Grade-A offices, IT parks, high-street retail spaces and commercial towers.',
    requiresPhase: false,
    requiresStructure: true,
    requiresFloor: true,
    hierarchyLabels: {
      phaseLabel: 'Phase / Campus',
      structureLabel: 'Building / Wing',
      floorLabel: 'Floor / Level',
      unitLabel: 'Office / Shop / Unit',
    },
  },
  CUSTOM_HIERARCHY: {
    key: 'CUSTOM_HIERARCHY',
    name: 'Mixed-Use / Custom Hierarchy',
    description: 'Flexible multi-format developments combining towers, villas, retail or resale portfolios.',
    requiresPhase: false,
    requiresStructure: false,
    requiresFloor: false,
    hierarchyLabels: {
      phaseLabel: 'Phase',
      structureLabel: 'Section / Structure',
      floorLabel: 'Level',
      unitLabel: 'Inventory Unit',
    },
  },
};

export const DESIGN_TOKENS = {
  colors: {
    light: {
      background: '#FAF9F6', // Soft ivory background
      surface: '#FFFFFF', // Crisp white card/panel surface
      surfaceMuted: '#F3F4F6', // Subtle warm/cool neutral surface
      primary: '#0F265C', // Deep navy / royal blue primary accent
      primaryHover: '#16357A',
      primaryForeground: '#FFFFFF',
      accent: '#1D4ED8', // Royal blue interactive highlight
      accentSubtle: '#EFF6FF',
      foreground: '#18181B', // Charcoal primary text
      mutedForeground: '#64748B', // Cool gray secondary text
      border: '#E2E8F0', // Thin neutral border
      input: '#CBD5E1',
      ring: '#1D4ED8',
      success: '#15803D',
      successSubtle: '#F0FDF4',
      warning: '#B45309',
      warningSubtle: '#FFFBEB',
      danger: '#B91C1C',
      dangerSubtle: '#FEF2F2',
      info: '#0369A1',
      infoSubtle: '#F0F9FF',
    },
    dark: {
      background: '#0B1120',
      surface: '#111827',
      surfaceMuted: '#1E293B',
      primary: '#3B82F6',
      primaryHover: '#60A5FA',
      primaryForeground: '#FFFFFF',
      accent: '#2563EB',
      accentSubtle: '#1E3A8A',
      foreground: '#F8FAFC',
      mutedForeground: '#94A3B8',
      border: '#1E293B',
      input: '#334155',
      ring: '#3B82F6',
      success: '#22C55E',
      successSubtle: '#052E16',
      warning: '#F59E0B',
      warningSubtle: '#451A03',
      danger: '#EF4444',
      dangerSubtle: '#450A0A',
      info: '#38BDF8',
      infoSubtle: '#082F49',
    },
    inventoryStatus: {
      AVAILABLE: { bg: '#ECFDF5', text: '#047857', border: '#A7F3D0', dot: '#10B981' },
      ON_HOLD: { bg: '#FFFBEB', text: '#B45309', border: '#FDE68A', dot: '#F59E0B' },
      RESERVED: { bg: '#EFF6FF', text: '#1D4ED8', border: '#BFDBFE', dot: '#3B82F6' },
      BOOKED: { bg: '#EEF2FF', text: '#3730A3', border: '#C7D2FE', dot: '#4F46E5' },
      AGREEMENT: { bg: '#F5F3FF', text: '#6D28D9', border: '#DDD6FE', dot: '#7C3AED' },
      REGISTERED: { bg: '#F1F5F9', text: '#334155', border: '#CBD5E1', dot: '#475569' },
    },
  },
  typography: {
    fontSans: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fontDisplay: "'Plus Jakarta Sans', 'Inter', -apple-system, sans-serif",
    fontMono: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  radii: {
    xs: '4px',
    sm: '6px',
    md: '8px',
    lg: '10px',
    xl: '12px',
  },
  spacing: {
    sidebarWidth: '256px',
    headerHeight: '60px',
    containerMax: '1440px',
  },
} as const;

export const BUILDER_PACKAGE_CODES = ['SINGLE_PROJECT', 'MULTI_PROJECT'] as const;
export type SaasPlanCode = (typeof BUILDER_PACKAGE_CODES)[number];

export interface SaasPlanDefinition {
  code: SaasPlanCode;
  name: string;
  tagline: string;
  monthlyPriceInr: number; // Base recurring INR before applicable taxes (min 2 projects for MULTI_PROJECT)
  perProjectMonthlyInr: number;
  minProjects: number;
  maxProjects: number | null; // 1 for SINGLE_PROJECT, null (bounded by paid subscribedProjectCapacity) for MULTI_PROJECT
  defaultTaxPct: number;
  features: string[];
  entitlements: {
    maxProjects: number; // 1 for SINGLE_PROJECT, dynamic >=2 for MULTI_PROJECT
    maxUsers: number; // -1 = unlimited role-based staff within organization
    customFormBuilder: boolean;
    channelPartnerPortal: boolean;
    multiProjectPortfolioReports: boolean;
    aiAssistantInterface: boolean;
    whatsappIntegrationInterface: boolean;
  };
}

export const BUILDER_SUBSCRIPTION_PACKAGES: Record<SaasPlanCode, SaasPlanDefinition> = {
  SINGLE_PROJECT: {
    code: 'SINGLE_PROJECT',
    name: 'Single Project Builder',
    tagline: 'Complete enterprise real estate operating system for one active project.',
    monthlyPriceInr: 5999,
    perProjectMonthlyInr: 5999,
    minProjects: 1,
    maxProjects: 1,
    defaultTaxPct: 18,
    features: [
      '1 active project (hard server-enforced limit)',
      'Project configuration, towers, floors & units',
      'Physical parking inventory & allocations',
      'Dynamic pricing & cost sheet generator',
      'Lead CRM, site visits & channel partners',
      'Controlled documents & audit reports',
      'Internal AI Assistant interface (prepaid AI Wallet)',
      'Official WhatsApp Cloud interface (prepaid WhatsApp Wallet)',
    ],
    entitlements: {
      maxProjects: 1,
      maxUsers: -1,
      customFormBuilder: true,
      channelPartnerPortal: true,
      multiProjectPortfolioReports: false,
      aiAssistantInterface: true,
      whatsappIntegrationInterface: true,
    },
  },
  MULTI_PROJECT: {
    code: 'MULTI_PROJECT',
    name: 'Multi-Project Builder',
    tagline: 'Scale across multiple developments at ₹4,999 per project/month (minimum 2 projects).',
    monthlyPriceInr: 9998,
    perProjectMonthlyInr: 4999,
    minProjects: 2,
    maxProjects: null,
    defaultTaxPct: 18,
    features: [
      'Minimum 2 active project slots (₹9,998/month)',
      '₹4,999/month per subscribed project slot (server-enforced capacity)',
      'All Single Project modules included',
      'Multi-project portfolio management & consolidated analytics',
      'Flexible slot upgrades & non-destructive project archiving',
      'Internal AI Assistant interface (prepaid AI Wallet)',
      'Official WhatsApp Cloud interface (prepaid WhatsApp Wallet)',
    ],
    entitlements: {
      maxProjects: 2,
      maxUsers: -1,
      customFormBuilder: true,
      channelPartnerPortal: true,
      multiProjectPortfolioReports: true,
      aiAssistantInterface: true,
      whatsappIntegrationInterface: true,
    },
  },
};

// Canonical alias maintained across web, mobile, and functions
export const DEFAULT_SAAS_PLANS = BUILDER_SUBSCRIPTION_PACKAGES;

/**
 * Deterministic recurring subscription price formula:
 * - SINGLE_PROJECT: ₹5,999/month, capacity = 1
 * - MULTI_PROJECT: ₹4,999 × MAX(2, subscribedProjectCapacity)
 */
export function calculateBuilderSubscriptionMonthlyInr(
  packageCode: SaasPlanCode,
  requestedProjectCapacity = 1,
  taxRatePct = 18
): {
  packageCode: SaasPlanCode;
  subscribedProjectCapacity: number;
  unitRateInr: number;
  monthlySubtotalInr: number;
  monthlyTaxInr: number;
  monthlyTotalInr: number;
} {
  if (packageCode === 'SINGLE_PROJECT') {
    const monthlySubtotalInr = 5999;
    const monthlyTaxInr = Math.round((monthlySubtotalInr * taxRatePct) / 100);
    return {
      packageCode: 'SINGLE_PROJECT',
      subscribedProjectCapacity: 1,
      unitRateInr: 5999,
      monthlySubtotalInr,
      monthlyTaxInr,
      monthlyTotalInr: monthlySubtotalInr + monthlyTaxInr,
    };
  }

  const subscribedProjectCapacity = Math.max(2, Math.floor(requestedProjectCapacity || 2));
  const unitRateInr = 4999;
  const monthlySubtotalInr = unitRateInr * subscribedProjectCapacity;
  const monthlyTaxInr = Math.round((monthlySubtotalInr * taxRatePct) / 100);
  return {
    packageCode: 'MULTI_PROJECT',
    subscribedProjectCapacity,
    unitRateInr,
    monthlySubtotalInr,
    monthlyTaxInr,
    monthlyTotalInr: monthlySubtotalInr + monthlyTaxInr,
  };
}

export const ONBOARDING_SERVICE_CODES = [
  'SELF_SERVICE',
  'ASSISTED_SINGLE_PROJECT',
  'ASSISTED_TWO_PROJECTS',
  'CUSTOM_ENTERPRISE_IMPORT',
] as const;

export type OnboardingServiceCode = (typeof ONBOARDING_SERVICE_CODES)[number];

export interface OnboardingServiceDefinition {
  code: OnboardingServiceCode;
  name: string;
  description: string;
  oneTimeFeeInr: number | null; // null = separately quoted
  requiresCustomQuote: boolean;
}

export const OPTIONAL_ONBOARDING_SERVICES: Record<
  OnboardingServiceCode,
  OnboardingServiceDefinition
> = {
  SELF_SERVICE: {
    code: 'SELF_SERVICE',
    name: 'Self-Service Onboarding',
    description: 'Configure projects, towers, units, and floor plans directly using built-in wizards.',
    oneTimeFeeInr: 0,
    requiresCustomQuote: false,
  },
  ASSISTED_SINGLE_PROJECT: {
    code: 'ASSISTED_SINGLE_PROJECT',
    name: 'Assisted Single-Project Onboarding',
    description: 'Dedicated specialist setup for 1 project, inventory matrix, price book, and cost sheet template.',
    oneTimeFeeInr: 9999,
    requiresCustomQuote: false,
  },
  ASSISTED_TWO_PROJECTS: {
    code: 'ASSISTED_TWO_PROJECTS',
    name: 'Assisted Onboarding (First Two Projects)',
    description: 'White-glove onboarding, floor-plan mapping, and team setup for your first 2 projects.',
    oneTimeFeeInr: 19999,
    requiresCustomQuote: false,
  },
  CUSTOM_ENTERPRISE_IMPORT: {
    code: 'CUSTOM_ENTERPRISE_IMPORT',
    name: 'Complex Legacy Data Migration & Custom Setup',
    description: 'Bespoke multi-project historical CRM/ERP migration and custom quotation templates.',
    oneTimeFeeInr: null,
    requiresCustomQuote: true,
  },
};

export const WALLET_TOPUP_PRESETS_INR = [500, 2000, 5000] as const;
export const MIN_CUSTOM_WALLET_TOPUP_INR = 100;
export const MAX_CUSTOM_WALLET_TOPUP_INR = 500000;
export const DEFAULT_SUBSCRIPTION_GRACE_DAYS = 7;

export const AI_BILLING_RATE_CARD_V1 = {
  version: 'AI_RATE_V2026_1',
  usdToInrRate: 87,
  models: {
    'gpt-4.1': { inputPer1MUsd: 2.0, outputPer1MUsd: 8.0, minChargePaise: 25 },
    'gpt-4.1-mini': { inputPer1MUsd: 0.4, outputPer1MUsd: 1.6, minChargePaise: 10 },
    'gpt-4.1-nano': { inputPer1MUsd: 0.1, outputPer1MUsd: 0.4, minChargePaise: 5 },
    'o4-mini': { inputPer1MUsd: 1.1, outputPer1MUsd: 4.4, minChargePaise: 25 },
  } as Record<string, { inputPer1MUsd: number; outputPer1MUsd: number; minChargePaise: number }>,
  defaultModelRate: { inputPer1MUsd: 2.0, outputPer1MUsd: 8.0, minChargePaise: 25 },
} as const;

export const WHATSAPP_BILLING_RATE_CARD_V1 = {
  version: 'WA_META_RATE_V2026_1',
  // Paise per billable conversation/template message by market & Meta category
  markets: {
    IN: { MARKETING: 88, UTILITY: 14, AUTHENTICATION: 14, SERVICE: 0 },
    AE: { MARKETING: 380, UTILITY: 150, AUTHENTICATION: 150, SERVICE: 0 },
    US: { MARKETING: 225, UTILITY: 40, AUTHENTICATION: 120, SERVICE: 0 },
    GB: { MARKETING: 460, UTILITY: 200, AUTHENTICATION: 220, SERVICE: 0 },
    ROW: { MARKETING: 500, UTILITY: 200, AUTHENTICATION: 200, SERVICE: 0 },
  } as Record<
    string,
    Record<'MARKETING' | 'UTILITY' | 'AUTHENTICATION' | 'SERVICE', number>
  >,
} as const;

export const PRIMARY_WEB_NAVIGATION = [
  { id: 'dashboard', label: 'Dashboard', path: '/builder/dashboard', group: 'Overview', permission: 'dashboard:view' },
  { id: 'projects-inventory', label: 'Projects & Inventory', path: '/builder/inventory', group: 'Inventory & Pricing', permission: 'inventory:view' },
  { id: 'parking', label: 'Parking', path: '/builder/parking', group: 'Inventory & Pricing', permission: 'parking:view' },
  { id: 'pricing-cost-sheets', label: 'Pricing & Cost Sheets', path: '/builder/pricing', group: 'Inventory & Pricing', permission: 'pricing:view' },
  { id: 'leads-crm', label: 'Leads & CRM', path: '/builder/leads', group: 'Sales & CRM', permission: 'leads:view' },
  { id: 'whatsapp-inbox', label: 'WhatsApp Inbox', path: '/builder/inbox', group: 'Sales & CRM', permission: 'whatsapp:view' },
  { id: 'channel-partners', label: 'Channel Partners', path: '/builder/channel-partners', group: 'Sales & CRM', permission: 'partners:view' },
  { id: 'site-visits', label: 'Site Visits', path: '/builder/visits', group: 'Sales & CRM', permission: 'visits:view' },
  { id: 'bookings-collections', label: 'Bookings & Collections', path: '/builder/bookings', group: 'Finance & Docs', permission: 'bookings:view' },
  { id: 'documents', label: 'Documents', path: '/builder/documents', group: 'Finance & Docs', permission: 'documents:view' },
  { id: 'reports-audit', label: 'Reports & Audit', path: '/builder/reports', group: 'Governance', permission: 'reports:view' },
  { id: 'settings', label: 'Settings', path: '/builder/settings', group: 'Governance', permission: 'settings:view' },
] as const;

export const MOBILE_BOTTOM_TABS = [
  { id: 'Dashboard', label: 'Dashboard', permission: 'dashboard:view' },
  { id: 'Inventory', label: 'Inventory', permission: 'inventory:view' },
  { id: 'Leads', label: 'Leads', permission: 'leads:view' },
  { id: 'Inbox', label: 'Inbox', permission: 'whatsapp:view' },
  { id: 'More', label: 'More', permission: 'dashboard:view' },
] as const;

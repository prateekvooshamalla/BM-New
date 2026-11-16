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

export type SaasPlanCode = 'STARTER' | 'GROWTH' | 'BUILDER_PRO' | 'ENTERPRISE';

export interface SaasPlanDefinition {
  code: SaasPlanCode;
  name: string;
  tagline: string;
  monthlyPriceInr: number | null; // null = Custom enterprise quote
  annualPriceInr: number | null;
  onboardingFeeInr: number;
  isCustomPricing: boolean;
  entitlements: {
    maxProjects: number; // -1 for unlimited
    maxUsers: number;
    monthlyAiCredits: number;
    monthlyWhatsappQuota: number;
    customFormBuilder: boolean;
    channelPartnerPortal: boolean;
    dedicatedSupport: boolean;
  };
  addonRatesInr: {
    extraUserMonthly: number;
    extraProjectMonthly: number;
    aiCreditsPack1000: number;
    whatsappConversationPack1000: number;
  };
}

export const DEFAULT_SAAS_PLANS: Record<SaasPlanCode, SaasPlanDefinition> = {
  STARTER: {
    code: 'STARTER',
    name: 'Starter',
    tagline: 'For boutique builders and emerging single-project developments.',
    monthlyPriceInr: 2999,
    annualPriceInr: 29990,
    onboardingFeeInr: 4999,
    isCustomPricing: false,
    entitlements: {
      maxProjects: 2,
      maxUsers: 10,
      monthlyAiCredits: 500,
      monthlyWhatsappQuota: 1000,
      customFormBuilder: true,
      channelPartnerPortal: false,
      dedicatedSupport: false,
    },
    addonRatesInr: {
      extraUserMonthly: 299,
      extraProjectMonthly: 1499,
      aiCreditsPack1000: 999,
      whatsappConversationPack1000: 799,
    },
  },
  GROWTH: {
    code: 'GROWTH',
    name: 'Growth',
    tagline: 'For growing developers managing multi-tower inventory and active CRM teams.',
    monthlyPriceInr: 9999,
    annualPriceInr: 99990,
    onboardingFeeInr: 9999,
    isCustomPricing: false,
    entitlements: {
      maxProjects: 8,
      maxUsers: 35,
      monthlyAiCredits: 2500,
      monthlyWhatsappQuota: 5000,
      customFormBuilder: true,
      channelPartnerPortal: true,
      dedicatedSupport: false,
    },
    addonRatesInr: {
      extraUserMonthly: 249,
      extraProjectMonthly: 1199,
      aiCreditsPack1000: 899,
      whatsappConversationPack1000: 699,
    },
  },
  BUILDER_PRO: {
    code: 'BUILDER_PRO',
    name: 'Builder Pro',
    tagline: 'Full-scale multi-city inventory, dynamic pricing, channel partners and collections.',
    monthlyPriceInr: 24999,
    annualPriceInr: 249990,
    onboardingFeeInr: 19999,
    isCustomPricing: false,
    entitlements: {
      maxProjects: 25,
      maxUsers: 120,
      monthlyAiCredits: 10000,
      monthlyWhatsappQuota: 25000,
      customFormBuilder: true,
      channelPartnerPortal: true,
      dedicatedSupport: true,
    },
    addonRatesInr: {
      extraUserMonthly: 199,
      extraProjectMonthly: 999,
      aiCreditsPack1000: 799,
      whatsappConversationPack1000: 599,
    },
  },
  ENTERPRISE: {
    code: 'ENTERPRISE',
    name: 'Enterprise',
    tagline: 'Tailored governance, unlimited scale, custom SLAs and dedicated onboarding.',
    monthlyPriceInr: null,
    annualPriceInr: null,
    onboardingFeeInr: 49999,
    isCustomPricing: true,
    entitlements: {
      maxProjects: -1,
      maxUsers: -1,
      monthlyAiCredits: 50000,
      monthlyWhatsappQuota: 100000,
      customFormBuilder: true,
      channelPartnerPortal: true,
      dedicatedSupport: true,
    },
    addonRatesInr: {
      extraUserMonthly: 149,
      extraProjectMonthly: 0,
      aiCreditsPack1000: 699,
      whatsappConversationPack1000: 499,
    },
  },
};

export const PRIMARY_WEB_NAVIGATION = [
  { id: 'dashboard', label: 'Dashboard', path: '/app/dashboard', group: 'Overview', permission: 'dashboard:view' },
  { id: 'projects-inventory', label: 'Projects & Inventory', path: '/app/inventory', group: 'Inventory & Pricing', permission: 'inventory:view' },
  { id: 'parking', label: 'Parking', path: '/app/parking', group: 'Inventory & Pricing', permission: 'parking:view' },
  { id: 'pricing-cost-sheets', label: 'Pricing & Cost Sheets', path: '/app/pricing', group: 'Inventory & Pricing', permission: 'pricing:view' },
  { id: 'leads-crm', label: 'Leads & CRM', path: '/app/leads', group: 'Sales & CRM', permission: 'leads:view' },
  { id: 'whatsapp-inbox', label: 'WhatsApp Inbox', path: '/app/inbox', group: 'Sales & CRM', permission: 'whatsapp:view' },
  { id: 'channel-partners', label: 'Channel Partners', path: '/app/channel-partners', group: 'Sales & CRM', permission: 'partners:view' },
  { id: 'site-visits', label: 'Site Visits', path: '/app/visits', group: 'Sales & CRM', permission: 'visits:view' },
  { id: 'bookings-collections', label: 'Bookings & Collections', path: '/app/bookings', group: 'Finance & Docs', permission: 'bookings:view' },
  { id: 'documents', label: 'Documents', path: '/app/documents', group: 'Finance & Docs', permission: 'documents:view' },
  { id: 'reports-audit', label: 'Reports & Audit', path: '/app/reports', group: 'Governance', permission: 'reports:view' },
  { id: 'settings', label: 'Settings', path: '/app/settings', group: 'Governance', permission: 'settings:view' },
] as const;

export const MOBILE_BOTTOM_TABS = [
  { id: 'Dashboard', label: 'Dashboard', permission: 'dashboard:view' },
  { id: 'Inventory', label: 'Inventory', permission: 'inventory:view' },
  { id: 'Leads', label: 'Leads', permission: 'leads:view' },
  { id: 'Inbox', label: 'Inbox', permission: 'whatsapp:view' },
  { id: 'More', label: 'More', permission: 'dashboard:view' },
] as const;

/**
 * @bharat-makaan/shared — Canonical Domain Entities (All 36 Core Firestore Collections)
 */

import type {
  AreaUnitCode,
  CurrencyCode,
  OnboardingServiceCode,
  ProjectStructureTemplateKey,
  SaasPlanCode,
} from '@bharat-makaan/config';
import type { PermissionKey, RoleKey } from './permissions';

export type ISODateString = string;

export type OrganizationType =
  | 'BUILDER'
  | 'DEVELOPER'
  | 'REAL_ESTATE_AGENCY'
  | 'ENTERPRISE_GROUP';

// 1. organizations
export interface Organization {
  id: string;
  name: string;
  slug: string;
  legalName: string;
  organizationType?: OrganizationType;
  countryCode?: string;
  stateOrRegion?: string;
  defaultCurrency?: CurrencyCode;
  defaultAreaUnit?: AreaUnitCode;
  defaultTimezone?: string;
  taxRegistrationLabel?: string;
  taxRegistrationNumber?: string;
  regulatoryAuthorityLabel?: string;
  regulatoryRegistrationNumber?: string;
  gstin?: string;
  pan?: string;
  reraNumber?: string;
  headquartersCity: string;
  address?: string;
  phone?: string;
  email?: string;
  logoUrl?: string;
  branding?: {
    primaryColor?: string;
    accentColor?: string;
    logoUrl?: string;
    quotationFooterText?: string;
  };
  taxRegime?: {
    primaryTaxLabel: string;
    primaryTaxPct: number;
    secondaryTaxLabel: string;
    secondaryTaxPct: number;
    exemptLabel: string;
  };
  defaultPricingRules?: {
    maxDiscountPctWithoutApproval?: number;
    floorRiseStartFloor?: number;
    floorRiseRatePerUnitArea?: number;
  };
  status: 'ACTIVE' | 'SUSPENDED';
  subscriptionPlanId: SaasPlanCode;
  leadProtectionDays: number; // Configurable lead protection window for channel partners
  whatsappAutoSendAi: boolean; // Must default to false; AI replies require human approval by default
  createdBy: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

// 2. organization_members
export interface OrganizationMember {
  id: string; // `${orgId}_${uid}`
  orgId: string;
  uid: string;
  email: string;
  displayName: string;
  phone?: string;
  role: RoleKey;
  permissions: PermissionKey[];
  assignedProjectIds: string[];
  department?: string;
  managerUid?: string;
  status: 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
  mfaRequired: boolean;
  mfaEnrolled?: boolean;
  invitedBy: string;
  invitedAt: ISODateString;
  lastActiveAt?: ISODateString;
  updatedAt: ISODateString;
}

// 3. projects
export type ProjectType =
  | 'APARTMENT'
  | 'VILLA'
  | 'INDEPENDENT_HOUSE'
  | 'PLOTTED'
  | 'COMMERCIAL'
  | 'OFFICE'
  | 'RETAIL'
  | 'MIXED'
  | 'RESALE_PORTFOLIO'
  | 'RENTAL_PORTFOLIO';

export type ConstructionStatus =
  | 'PRE_LAUNCH'
  | 'NEW_LAUNCH'
  | 'UNDER_CONSTRUCTION'
  | 'NEARING_POSSESSION'
  | 'READY_TO_MOVE';

export interface ProjectHierarchyLabels {
  phaseLabel: string;
  structureLabel: string;
  floorLabel: string;
  unitLabel: string;
  requiresStructure: boolean;
  requiresFloor: boolean;
}

export interface ProjectStats {
  totalUnits: number;
  availableUnits: number;
  onHoldUnits: number;
  reservedUnits: number;
  bookedUnits: number;
  agreementUnits: number;
  registeredUnits: number;
  totalLeads: number;
  totalSiteVisits: number;
  bookedSalesValueInr: number;
  collectionsVerifiedInr: number;
  pendingTasksCount: number;
}

export type ProjectLifecycleStatus = 'ACTIVE' | 'ARCHIVED_READ_ONLY';

export interface Project {
  id: string;
  orgId: string;
  builderName: string;
  name: string;
  slug?: string;
  code: string;
  lifecycleStatus?: ProjectLifecycleStatus;
  countryCode?: string;
  stateOrRegion?: string;
  city: string;
  locality: string;
  address: string;
  coordinates?: { lat: number; lng: number };
  postalCode?: string;
  landmark?: string;
  description?: string;
  currencyCode?: CurrencyCode;
  areaUnit?: AreaUnitCode;
  timezone?: string;
  projectType: ProjectType;
  structureTemplate?: ProjectStructureTemplateKey;
  hierarchyLabels?: ProjectHierarchyLabels;
  regulatoryAuthorityLabel?: string;
  reraNumber: string;
  reraValidUntil?: ISODateString;
  defaultCostSheetTemplateId?: string | null;
  landAreaAcres?: number;
  totalPhases: number;
  totalTowers: number;
  totalFloors: number;
  totalUnits: number;
  configurations: string[]; // e.g., ["2 BHK", "3 BHK", "4 BHK"]
  amenities: string[];
  constructionStatus: ConstructionStatus;
  possessionDate?: ISODateString;
  heroImageUrl?: string;
  galleryImageUrls: string[];
  videoUrls: string[];
  brochureDocumentId?: string;
  masterPlanDocumentId?: string;
  teamMemberUids: string[];
  isPublicPublished: boolean;
  listingIntent: 'BUY' | 'RENT' | 'BOTH';
  startingPriceInr?: number;
  stats: ProjectStats;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

// 4. project_phases
export interface ProjectPhase {
  id: string;
  orgId: string;
  projectId: string;
  name: string;
  code: string;
  sequence: number;
  reraNumber?: string;
  constructionStatus: ConstructionStatus;
  possessionDate?: ISODateString;
  totalTowers: number;
  totalUnits: number;
  createdAt: ISODateString;
}

// 5. towers (generic structures: towers, blocks, buildings, sectors, villa clusters, communities)
export type TowerKind =
  | 'TOWER'
  | 'BLOCK'
  | 'BUILDING'
  | 'SECTOR'
  | 'VILLA_CLUSTER'
  | 'COMMUNITY'
  | 'RETAIL_WING';

export interface Tower {
  id: string;
  orgId: string;
  projectId: string;
  phaseId?: string | null;
  name: string;
  code: string;
  towerType: TowerKind;
  totalFloors: number;
  basementLevels: number;
  podiumLevels: number;
  unitsPerFloorTypical: number;
  status: 'ACTIVE' | 'PLANNED' | 'HANDED_OVER';
  createdAt: ISODateString;
}

// 6. floors
export type FloorCategory =
  | 'PODIUM'
  | 'LOWER_RESIDENTIAL'
  | 'TYPICAL'
  | 'PENTHOUSE'
  | 'REFUGE'
  | 'COMMERCIAL'
  | 'GROUND_PLOT';

export interface Floor {
  id: string;
  orgId: string;
  projectId: string;
  phaseId?: string | null;
  towerId: string;
  floorNumber: number;
  label: string;
  floorCategory: FloorCategory;
  totalUnits: number;
  createdAt: ISODateString;
}

// 7. units
export type UnitStatus =
  | 'AVAILABLE'
  | 'ON_HOLD'
  | 'RESERVED'
  | 'BOOKED'
  | 'AGREEMENT'
  | 'REGISTERED';

export type UnitType =
  | 'APARTMENT'
  | 'PENTHOUSE'
  | 'VILLA'
  | 'INDEPENDENT_HOUSE'
  | 'PLOT'
  | 'SHOP'
  | 'RETAIL_SPACE'
  | 'OFFICE'
  | 'COMMERCIAL_UNIT';

export type InventorySource = 'PRIMARY_DEVELOPER' | 'RESALE' | 'RENTAL_MANAGED';
export type UnitPricingMode = 'PER_AREA' | 'BASE_UNIT_PRICE';

export type FacingDirection =
  | 'EAST'
  | 'WEST'
  | 'NORTH'
  | 'SOUTH'
  | 'NORTH_EAST'
  | 'NORTH_WEST'
  | 'SOUTH_EAST'
  | 'SOUTH_WEST';

export interface RoomDetail {
  name: string;
  type: 'BEDROOM' | 'BATHROOM' | 'LIVING' | 'DINING' | 'KITCHEN' | 'BALCONY' | 'STUDY' | 'UTILITY' | 'OTHER';
  lengthFt?: number;
  widthFt?: number;
}

export interface Unit {
  id: string;
  orgId: string;
  projectId: string;
  phaseId?: string | null;
  towerId?: string | null;
  towerName?: string;
  floorId?: string | null;
  floorNumber: number; // 0 for plots/villas without apartment floors
  series?: string; // Unique flat series per floor in a tower/project (e.g., "01", "02", "1", "A")
  unitNumber: string;
  unitType: UnitType;
  inventorySource?: InventorySource;
  bhk: string; // e.g., "3 BHK", "4 BHK", "Villa", "Plot", "Grade-A Office"
  currencyCode?: CurrencyCode;
  areaUnit?: AreaUnitCode;
  primaryArea?: number;
  secondaryArea?: number;
  saleableAreaSqft: number;
  carpetAreaSqft: number;
  plotAreaSqft?: number;
  facing: FacingDirection;
  viewType?: string; // e.g., "CENTRAL_PARK", "POOL", "CITY", "STANDARD"
  isCorner: boolean;
  balconiesCount: number;
  bedroomsCount?: number;
  bathroomsCount?: number;
  furnishing?: 'UNFURNISHED' | 'SEMI_FURNISHED' | 'FULLY_FURNISHED';
  roomDetails?: RoomDetail[];
  unitAmenities?: string[];
  parkingEntitlementCount: number; // Entitlement count (distinct from physical assigned slots)
  assignedParkingSlotIds: string[]; // Physical parking slot IDs allocated
  pricingMode?: UnitPricingMode;
  baseUnitPrice?: number;
  baseRatePerSqft: number;
  activePriceBookId?: string;
  floorRiseAmount: number;
  premiumChargesAmount: number;
  calculatedTotalPrice: number;
  calculatedTotalMinor?: number;
  status: UnitStatus;
  holdExpiresAt?: ISODateString | null;
  heldByUid?: string | null;
  heldForLeadId?: string | null;
  holdAdvanceAmount?: number;
  holdPaymentReference?: string | null;
  floorPlanStoragePath?: string | null;
  activeBookingId?: string | null;
  floorPlanVersionId?: string | null;
  isPublicPublished: boolean;
  listingMode: 'BUY' | 'RENT' | 'LEASE';
  monthlyRentInr?: number;
  securityDepositInr?: number;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

// 8. parking_slots
export type ParkingLevelType = 'BASEMENT' | 'PODIUM' | 'SURFACE' | 'STILT';
export type ParkingSlotType = 'STANDARD' | 'TANDEM' | 'MECHANICAL' | 'EV' | 'ACCESSIBLE';
export type ParkingSlotStatus = 'AVAILABLE' | 'ALLOCATED' | 'BLOCKED';

export interface ParkingSlot {
  id: string; // `${projectId}_${levelCode}_${slotNumber}`
  orgId: string;
  projectId: string;
  towerId?: string | null;
  levelType: ParkingLevelType;
  levelName: string; // e.g., "B1", "B2", "P1"
  zone: string; // e.g., "Zone A"
  slotNumber: string; // Unique within project/level scheme
  parkingType: ParkingSlotType;
  priceInr: number;
  status: ParkingSlotStatus;
  allocatedUnitId?: string | null;
  allocatedUnitNumber?: string | null;
  allocatedBookingId?: string | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

// 9. parking_allocations
export interface ParkingAllocation {
  id: string;
  orgId: string;
  projectId: string;
  slotId: string;
  slotNumber: string;
  unitId: string;
  unitNumber: string;
  bookingId?: string | null;
  action: 'ALLOCATED' | 'RELEASED' | 'SWAPPED';
  swappedWithSlotId?: string | null;
  priceSnapshotInr: number;
  performedByUid: string;
  reason: string;
  createdAt: ISODateString;
}

// 10. floor_plan_versions
export interface FloorPlanVersion {
  id: string;
  orgId: string;
  documentId: string;
  projectId: string;
  towerIds: string[];
  floorCategory: FloorCategory;
  minFloor: number;
  maxFloor: number;
  applicableUnitTypes: UnitType[];
  applicableBhk: string[];
  carpetAreaSqft: number;
  saleableAreaSqft: number;
  versionNumber: number;
  storagePath: string;
  fileName: string;
  aiExtractedSpecs?: Record<string, unknown>;
  createdByUid: string;
  createdAt: ISODateString;
}

// 11. price_books & 12. price_rules
export type PriceBookStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'SCHEDULED'
  | 'ACTIVE'
  | 'ARCHIVED'
  | 'REJECTED';

export type ChargeCalculationBasis =
  | 'PER_SQFT_SALEABLE'
  | 'PER_SQFT_CARPET'
  | 'PER_PRIMARY_AREA'
  | 'PER_SECONDARY_AREA'
  | 'FIXED_AMOUNT'
  | 'PERCENTAGE_OF_BASE';

export type TaxApplicabilityCategory =
  | 'AGREEMENT_GST' // Primary agreement tax (e.g., GST, VAT, Transfer Tax)
  | 'OTHER_SERVICE_GST' // Secondary service tax (e.g., Service GST / VAT)
  | 'EXEMPT_CORPUS' // 0% exempt (e.g., Corpus / Sinking fund deposit)
  | 'PRIMARY_TAX'
  | 'SECONDARY_TAX'
  | 'EXEMPT';

export interface CostSheetLineItemRule {
  id: string;
  internalKey: string; // Stable immutable identifier (e.g. "amenities_charges", "custom_club_fee")
  displayLabel: string; // Editable builder label (e.g. "Amenities & Infrastructure Development Charges")
  description?: string;
  basis: ChargeCalculationBasis;
  amount: number; // Rate per area, fixed currency amount, or percentage
  taxCategory: TaxApplicabilityCategory;
  applicableUnitTypes?: UnitType[];
  applicableBhk?: string[];
  unitSpecificOverrides?: Record<string, number>;
  isOptional: boolean;
  isVisible: boolean;
  isRemovable: boolean;
  displayOrder: number;
}

export interface FloorRiseRule {
  enabled: boolean;
  startFloor: number; // Floor from which floor rise applies (inclusive)
  ratePerFloorPerSqft: number;
}

export interface TaxConfiguration {
  agreementGstPct: number; // Primary tax percentage (e.g., 5% GST, 0% VAT, 1.5% Transfer Tax)
  otherServiceGstPct: number; // Secondary/service tax percentage (e.g., 18% GST, 5% VAT)
  primaryTaxLabel?: string; // e.g., "GST", "VAT", "Transfer Tax", "Stamp Duty"
  secondaryTaxLabel?: string; // e.g., "Service GST", "Service VAT"
  exemptTaxLabel?: string; // e.g., "Tax Exempt"
  roundingMode: 'NEAREST_RUPEE' | 'EXACT_PAISE' | 'NEAREST_UNIT' | 'MINOR_UNIT';
  registrationDisclaimer: string;
}

export interface PromotionalOfferRule {
  id: string;
  code: string;
  label: string;
  offerType: 'PERCENTAGE_REBATE' | 'FIXED_REBATE' | 'FLOOR_RISE_WAIVER' | 'PARKING_WAIVER';
  value: number;
  isActive: boolean;
  validUntil?: ISODateString | null;
}

export type PricingScopeLevel =
  | 'ORGANIZATION'
  | 'PROJECT'
  | 'PHASE'
  | 'STRUCTURE'
  | 'UNIT_TYPE'
  | 'UNIT';

export interface PricingScopeOverride {
  id: string;
  orgId: string;
  projectId?: string | null;
  scopeLevel: PricingScopeLevel;
  targetId: string; // orgId, projectId, phaseId, towerId, unitType/bhk, or unitId
  label?: string;
  versionNumber: number;
  isActive: boolean;
  currencyCode?: CurrencyCode;
  areaUnit?: AreaUnitCode;
  pricingMode?: UnitPricingMode;
  basePricePerArea?: number;
  baseUnitPrice?: number;
  baseConsiderationLabel?: string;
  floorRise?: Partial<FloorRiseRule>;
  facingPremiumPerSqft?: Partial<Record<FacingDirection, number>>;
  viewPremiumPerSqft?: Record<string, number>;
  cornerPremiumPerSqft?: number;
  locationPremiumPerSqft?: number;
  parkingPricesByType?: Partial<Record<ParkingSlotType, number>>;
  lineItemsOverride?: CostSheetLineItemRule[];
  taxConfigOverride?: Partial<TaxConfiguration>;
  maxDiscountPctWithoutApproval?: number;
  offers?: PromotionalOfferRule[];
  effectiveFrom: ISODateString;
  createdByUid: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface CostSheetTemplate {
  id: string;
  orgId: string;
  projectId?: string | null; // null = reusable org-wide template; projectId = project-specific template
  name: string;
  code: string;
  isDefault: boolean;
  headerConfig: {
    title: string;
    subtitle?: string;
    showOrgLogo: boolean;
    showRegulatoryNumber: boolean;
    accentColor: string;
  };
  sectionToggles: {
    showCustomerSection: boolean;
    showUnitSection: boolean;
    showAreaBreakdown: boolean;
    showParkingBreakdown: boolean;
    showTaxBreakdown: boolean;
    showOfferRebates: boolean;
    showPaymentSchedule: boolean;
    showTerms: boolean;
    showSalesRepSection: boolean;
    showSignatureBlocks: boolean;
  };
  customLabels: {
    unitSectionTitle: string;
    customerSectionTitle: string;
    pricingTableTitle: string;
    primaryTaxSummaryLabel: string;
    secondaryTaxSummaryLabel: string;
    exemptSummaryLabel: string;
    netConsiderationLabel: string;
    grandTotalLabel: string;
    scheduleSectionTitle: string;
  };
  defaultTermsAndConditions: string;
  footerText: string;
  createdByUid: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface PriceBook {
  id: string;
  orgId: string;
  projectId: string;
  name: string;
  description?: string;
  versionNumber: number;
  parentPriceBookId?: string | null;
  status: PriceBookStatus;
  isImmutable: boolean;
  effectiveFrom: ISODateString;
  expiresAt?: ISODateString | null;
  currencyCode?: CurrencyCode;
  areaUnit?: AreaUnitCode;
  pricingMode?: UnitPricingMode;
  baseUnitPrice?: number;
  baseConsiderationLabel?: string;
  floorRiseLabel?: string;
  parkingLabel?: string;
  basePricePerSqft: number;
  floorRise: FloorRiseRule;
  facingPremiumPerSqft: Partial<Record<FacingDirection, number>>;
  viewPremiumPerSqft: Record<string, number>;
  cornerPremiumPerSqft: number;
  locationPremiumPerSqft: number;
  unitSpecificPremiumInr: Record<string, number>;
  parkingPricesByType: Record<ParkingSlotType, number>;
  lineItems: CostSheetLineItemRule[];
  taxConfig: TaxConfiguration;
  offers?: PromotionalOfferRule[];
  maxDiscountPctWithoutApproval: number;
  defaultPaymentPlanId?: string | null;
  internalNotes?: string;
  createdByUid: string;
  approvedByUid?: string | null;
  approvedAt?: ISODateString | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface PriceRule extends CostSheetLineItemRule {
  orgId: string;
  projectId: string;
  priceBookId: string;
  updatedAt: ISODateString;
}

// 13. price_revisions
export interface PriceRevision {
  id: string;
  orgId: string;
  projectId: string;
  unitId?: string | null;
  unitNumber?: string | null;
  previousPriceBookId?: string | null;
  newPriceBookId: string;
  priceBookVersion: number;
  oldBaseRate: number;
  newBaseRate: number;
  oldTotalValue: number;
  newTotalValue: number;
  changeAmount: number;
  changePct: number;
  effectiveDate: ISODateString;
  changedByUid: string;
  approvedByUid: string;
  reason: string;
  createdAt: ISODateString;
}

// 14. payment_plans
export interface PaymentPlanMilestone {
  sequence: number;
  name: string;
  description?: string;
  percentage: number; // Reconciles across milestones to 100
  fixedAmountOverrideInr?: number;
  dueTrigger: string; // e.g. "On Booking", "Within 30 Days of Booking", "On Casting of 7th Floor Slab", "On Possession"
  estimatedDate?: ISODateString;
  taxTreatment: 'PROPORTIONAL_GST' | 'INCLUDE_POSSESSION_CHARGES';
  notes?: string;
}

export interface PaymentPlan {
  id: string;
  orgId: string;
  projectId: string;
  name: string;
  planType: 'CONSTRUCTION_LINKED' | 'DATE_LINKED' | 'DOWN_PAYMENT' | 'CUSTOM';
  isActive: boolean;
  milestones: PaymentPlanMilestone[];
  totalPercentage: number;
  createdByUid: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

// 15. quotations & 16. quotation_versions
export interface ComputedLineItem {
  internalKey: string;
  displayLabel: string;
  basis: ChargeCalculationBasis | 'SYSTEM_FORMULA';
  rateOrInput: number;
  baseAmountInr: number;
  taxCategory: TaxApplicabilityCategory;
  gstPct: number;
  gstAmountInr: number;
  totalWithGstInr: number;
  displayOrder: number;
}

export interface ComputedMilestoneInstallment {
  sequence: number;
  name: string;
  dueTrigger: string;
  estimatedDate?: ISODateString;
  percentage: number;
  installmentBaseInr: number;
  installmentGstInr: number;
  possessionChargesWithGstInr: number;
  totalInstallmentPayableInr: number;
}

export interface CostSheetBreakdown {
  currencyCode?: CurrencyCode;
  areaUnit?: AreaUnitCode;
  pricingMode?: UnitPricingMode;
  primaryTaxLabel?: string;
  secondaryTaxLabel?: string;
  saleableAreaSqft: number;
  carpetAreaSqft: number;
  baseRatePerSqft: number;
  basePriceInr: number;
  floorRiseInr: number;
  facingPremiumInr: number;
  viewPremiumInr: number;
  cornerPremiumInr: number;
  locationPremiumInr: number;
  unitSpecificPremiumInr: number;
  parkingChargesInr: number;
  grossAgreementComponentsInr: number;
  offerDiscountInr?: number;
  appliedOfferCodes?: string[];
  discountAmountInr: number;
  discountEffectivePct: number;
  requiresDiscountApproval: boolean;
  netAgreementValueBeforeGstInr: number; // Consideration value subject to primary tax
  agreementGstInr: number;
  otherServiceChargesBeforeGstInr: number; // Subject to secondary/service tax
  otherServiceGstInr: number;
  exemptCorpusChargesInr: number; // 0% exempt
  totalBeforeTaxInr: number;
  totalGstInr: number;
  totalPayableInr: number; // Final payable amount in project currency
  totalPayableMinor?: number;
  appliedOverrideChain?: Array<{
    scopeLevel: PricingScopeLevel;
    overrideId: string;
    targetId: string;
    versionNumber: number;
  }>;
  lineItems: ComputedLineItem[];
  schedule: ComputedMilestoneInstallment[];
  registrationDisclaimer: string;
}

export interface Quotation {
  id: string;
  orgId: string;
  projectId: string;
  towerId?: string | null;
  floorId?: string | null;
  unitId: string;
  unitNumber: string;
  quotationNumber: string;
  currentVersion: number;
  status:
    | 'DRAFT'
    | 'PENDING_APPROVAL'
    | 'ISSUED'
    | 'SHARED'
    | 'ACCEPTED'
    | 'EXPIRED'
    | 'SUPERSEDED';
  leadId?: string | null;
  partnerOrgId?: string | null;
  currencyCode?: CurrencyCode;
  areaUnit?: AreaUnitCode;
  costSheetTemplateId?: string | null;
  appliedOfferCodes?: string[];
  customer: {
    name: string;
    phone: string;
    email?: string;
    address?: string;
  };
  priceBookId: string;
  priceBookVersion: number;
  paymentPlanId: string;
  selectedParkingSlotIds: string[];
  parkingSlotsCount: number;
  parkingTypeUsed: ParkingSlotType;
  discount: {
    type: 'NONE' | 'FIXED_INR' | 'PER_SQFT' | 'PERCENTAGE_OF_BASE';
    value: number;
    reason?: string;
  };
  breakdown: CostSheetBreakdown;
  totalPayableInr: number;
  validUntil: ISODateString;
  termsAndConditions: string;
  aiCustomerSummary?: string;
  aiWhatsappShareText?: string;
  latestPdfStoragePath?: string;
  salesRepUid: string;
  salesRepName: string;
  approvedByUid?: string | null;
  approvedAt?: ISODateString | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface QuotationVersion {
  id: string; // `${quotationId}_v${version}`
  orgId: string;
  quotationId: string;
  version: number;
  priceBookSnapshot: PriceBook;
  paymentPlanSnapshot: PaymentPlan;
  breakdown: CostSheetBreakdown;
  pdfStoragePath?: string;
  createdByUid: string;
  createdAt: ISODateString;
}

// 17. leads & 18. lead_activities
export type LeadStage =
  | 'NEW'
  | 'CONTACTED'
  | 'QUALIFIED'
  | 'INTERESTED'
  | 'VISIT_SCHEDULED'
  | 'VISITED'
  | 'NEGOTIATION'
  | 'BOOKED'
  | 'CLOSED'
  | 'LOST'
  | 'UNQUALIFIED';

export type LeadSource =
  | 'WEBSITE'
  | 'PUBLIC_PORTAL'
  | 'FACEBOOK_ADS'
  | 'INSTAGRAM_ADS'
  | 'INSTAGRAM_DM'
  | 'MESSENGER'
  | 'WHATSAPP'
  | 'GOOGLE_ADS'
  | 'CHANNEL_PARTNER'
  | 'CSV_IMPORT'
  | 'MANUAL'
  | 'HOSTED_FORM'
  | 'WEBHOOK';

export interface Lead {
  id: string;
  orgId: string;
  projectId?: string | null;
  currencyCode?: CurrencyCode;
  customerName: string;
  phone: string;
  normalizedPhone: string;
  email?: string;
  normalizedEmail?: string;
  source: LeadSource;
  campaign?: string;
  budgetMinInr?: number;
  budgetMaxInr?: number;
  preferredLocation?: string;
  preferredProjectIds: string[];
  bhkPreference?: string;
  propertyType?: ProjectType;
  buyingTimeline?: 'IMMEDIATE' | '1_TO_3_MONTHS' | '3_TO_6_MONTHS' | '6_PLUS_MONTHS';
  assignedAgentUid?: string | null;
  partnerOrgId?: string | null;
  partnerAgentUid?: string | null;
  protectionExpiresAt?: ISODateString | null;
  stage: LeadStage;
  isCustomer?: boolean; // Converted to customer
  customerConvertedAt?: ISODateString | null;
  convertedByUid?: string | null;
  qualificationStatus: 'UNREVIEWED' | 'HOT' | 'WARM' | 'COLD' | 'DISQUALIFIED';
  lostReason?: string;
  leadScore: number;
  duplicateOfLeadId?: string | null;
  notesSummary?: string;
  nextFollowUpAt?: ISODateString | null;
  linkedQuotationIds: string[];
  linkedBookingIds: string[];
  whatsappOptIn: boolean;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface LeadActivity {
  id: string;
  orgId: string;
  leadId: string;
  type:
    | 'NOTE'
    | 'CALL'
    | 'TASK'
    | 'FOLLOW_UP'
    | 'STAGE_CHANGE'
    | 'ASSIGNMENT'
    | 'WHATSAPP'
    | 'VISIT'
    | 'QUOTATION'
    | 'AI_INSIGHT';
  title: string;
  body?: string;
  dueAt?: ISODateString;
  completedAt?: ISODateString | null;
  performedByUid: string;
  metadata?: Record<string, unknown>;
  createdAt: ISODateString;
}

// 19. partner_organizations, 20. partner_members, 21. lead_registrations
export interface PartnerBuilderScope {
  orgId: string;
  projectIds: string[];
  commissionPct: number;
  commissionTerms: string;
  status: 'PENDING' | 'AUTHORIZED' | 'SUSPENDED';
}

export interface PartnerOrganization {
  id: string;
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  registrationNumber?: string;
  reraNumber?: string;
  gstin?: string;
  officeCity: string;
  officeAddress?: string;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED';
  authorizedOrgIds: string[];
  builderScopes: Record<string, PartnerBuilderScope>;
  metrics: {
    registeredLeadsCount: number;
    siteVisitsCount: number;
    bookingsCount: number;
    eligibleCommissionInr: number;
    paidCommissionInr: number;
  };
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface PartnerMember {
  id: string; // `${partnerOrgId}_${uid}`
  partnerOrgId: string;
  uid: string;
  email: string;
  displayName: string;
  phone?: string;
  role: 'CHANNEL_PARTNER_ADMIN' | 'CHANNEL_PARTNER_AGENT';
  permissions: PermissionKey[];
  status: 'INVITED' | 'ACTIVE' | 'SUSPENDED';
  createdAt: ISODateString;
}

export interface LeadRegistration {
  id: string; // `${orgId}_${projectId}_${phoneHash}`
  orgId: string;
  projectId: string;
  leadId: string;
  partnerOrgId: string;
  partnerMemberUid: string;
  customerName: string;
  normalizedPhone: string;
  source: 'CHANNEL_PARTNER';
  status: 'PROTECTED' | 'DISPUTED' | 'EXPIRED' | 'CONVERTED' | 'REJECTED';
  protectedUntil: ISODateString;
  disputedByPartnerOrgId?: string | null;
  conflictReason?: string;
  resolvedByUid?: string | null;
  resolutionNotes?: string;
  registeredAt: ISODateString;
  updatedAt: ISODateString;
}

// 22. conversations & 23. messages
export interface Conversation {
  id: string;
  orgId: string;
  leadId?: string | null;
  customerPhone: string;
  customerName: string;
  channel: 'WHATSAPP' | 'INSTAGRAM_DM' | 'MESSENGER';
  assignedAgentUid?: string | null;
  status: 'OPEN' | 'PENDING_HANDOVER' | 'RESOLVED';
  lastCustomerMessageAt?: ISODateString | null; // Determines 24h Meta customer-service window
  optInStatus: 'OPTED_IN' | 'OPTED_OUT' | 'UNKNOWN';
  unreadCount: number;
  lastMessagePreview?: string;
  updatedAt: ISODateString;
  createdAt: ISODateString;
}

export interface Message {
  id: string;
  orgId: string;
  conversationId: string;
  leadId?: string | null;
  direction: 'INBOUND' | 'OUTBOUND';
  messageType: 'TEXT' | 'TEMPLATE' | 'DOCUMENT' | 'IMAGE' | 'AI_DRAFT';
  content: string;
  templateName?: string;
  templateLanguage?: string;
  documentId?: string;
  quotationId?: string;
  waMessageId?: string;
  deliveryStatus:
    | 'DRAFT_PENDING_APPROVAL'
    | 'QUEUED'
    | 'SENT'
    | 'DELIVERED'
    | 'READ'
    | 'FAILED';
  aiGenerated: boolean;
  approvedByUid?: string | null;
  sentByUid?: string | null;
  errorDetails?: string;
  createdAt: ISODateString;
}

// 24. site_visits
export interface SiteVisit {
  id: string;
  orgId: string;
  projectId: string;
  unitId?: string | null;
  leadId?: string | null;
  partnerOrgId?: string | null;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  assignedAgentUid?: string | null;
  scheduledStartAt: ISODateString; // UTC ISO
  scheduledEndAt: ISODateString;
  timezone: string;
  status: 'SCHEDULED' | 'CONFIRMED' | 'RESCHEDULED' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED';
  outcome?: 'VERY_INTERESTED' | 'SHORTLISTED' | 'PRICE_NEGOTIATION' | 'NOT_SUITABLE' | 'BOOKED';
  notes?: string;
  followUpAt?: ISODateString | null;
  reminderJobKey: string; // Idempotency key
  reminderSentAt?: ISODateString | null;
  createdByUid?: string | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

// 25. bookings, 26. collection_records, 27. reconciliation_records
export type BookingStatus =
  | 'HOLD_REQUESTED'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'BOOKED'
  | 'AGREEMENT_EXECUTED'
  | 'REGISTERED'
  | 'CANCELLED';

export interface Booking {
  id: string;
  orgId: string;
  bookingNumber: string;
  projectId: string;
  towerId?: string | null;
  unitId: string;
  unitNumber: string;
  quotationId: string;
  leadId: string;
  partnerOrgId?: string | null;
  customer: {
    fullName: string;
    coApplicantName?: string;
    phone: string;
    email: string;
    panNumber?: string;
    aadhaarLast4?: string;
    permanentAddress: string;
  };
  allocatedParkingSlotIds: string[];
  agreementValueInr: number;
  totalPayableInr: number;
  tokenAmountExpectedInr: number;
  totalCollectedVerifiedInr: number;
  outstandingBalanceInr: number;
  status: BookingStatus;
  cancellationReason?: string;
  requestedByUid: string;
  approvedByUid?: string | null;
  bookedAt?: ISODateString | null;
  cancelledAt?: ISODateString | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface CollectionRecord {
  id: string;
  orgId: string;
  bookingId: string;
  projectId: string;
  unitId: string;
  recordType: 'TOKEN' | 'MILESTONE_DEMAND' | 'RECEIPT' | 'PARTIAL_PAYMENT' | 'REFUND';
  milestoneSequence?: number;
  milestoneName: string;
  demandAmountInr: number;
  paidAmountInr: number;
  allocatedAmountInr: number;
  paymentMode: 'RAZORPAY' | 'NEFT' | 'RTGS' | 'IMPS' | 'CHEQUE' | 'DD';
  instrumentRef?: string;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  razorpaySignatureVerified: boolean;
  receiptNumber?: string;
  status: 'DUE' | 'PENDING_VERIFICATION' | 'VERIFIED' | 'BOUNCED' | 'REFUNDED';
  dueDate?: ISODateString;
  paidAt?: ISODateString;
  recordedByUid: string;
  notes?: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface ReconciliationRecord {
  id: string;
  orgId: string;
  bookingId: string;
  collectionRecordId: string;
  bankStatementRef: string;
  settlementId?: string;
  expectedAmountInr: number;
  settledAmountInr: number;
  gatewayFeeInr: number;
  discrepancyAmountInr: number;
  status: 'MATCHED' | 'DISCREPANCY' | 'RESOLVED';
  reconciledByUid: string;
  notes?: string;
  reconciledAt: ISODateString;
}

export interface PaymentReminderRecord {
  id: string;
  orgId: string;
  projectId: string;
  bookingId: string;
  collectionRecordId?: string | null;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  unitNumber: string;
  channel: 'WHATSAPP' | 'EMAIL' | 'SMS';
  amountDueInr: number;
  milestoneName: string;
  dueDate: string;
  isOverdue: boolean;
  message: string;
  sentByUid: string;
  sentAt: string;
  status: 'SENT' | 'DELIVERED' | 'FAILED';
  createdAt: string;
}

// 28. documents
export type DocumentCategory =
  | 'MASTER_PLAN'
  | 'TOWER_PLAN'
  | 'FLOOR_PLAN'
  | 'UNIT_LAYOUT'
  | 'BROCHURE'
  | 'PRICE_SHEET'
  | 'RERA_DOC'
  | 'APPROVAL_FILE'
  | 'COST_SHEET'
  | 'BOOKING_DOC'
  | 'PAYMENT_RECEIPT';

export interface DocumentRecord {
  id: string;
  orgId: string;
  projectId?: string | null;
  towerId?: string | null;
  floorId?: string | null;
  unitId?: string | null;
  category: DocumentCategory;
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  currentVersion: number;
  versionHistory: Array<{
    version: number;
    storagePath: string;
    fileName: string;
    uploadedByUid: string;
    uploadedAt: ISODateString;
  }>;
  visibility: 'INTERNAL' | 'PARTNER' | 'CUSTOMER' | 'PUBLIC';
  watermarkEnabled: boolean;
  shareLinks: Array<{
    tokenId: string;
    expiresAt: ISODateString;
    createdByUid: string;
    revoked: boolean;
  }>;
  uploadedByUid: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

// 29. forms & 30. form_submissions
export type FormFieldType =
  | 'TEXT'
  | 'NUMBER'
  | 'PHONE'
  | 'EMAIL'
  | 'DROPDOWN'
  | 'CHECKBOX'
  | 'RADIO'
  | 'DATE'
  | 'BUDGET'
  | 'PROPERTY_INTEREST'
  | 'PROJECT_SELECTOR'
  | 'BHK';

export interface FormFieldCondition {
  dependsOnFieldId: string;
  equalsValue: string;
}

export interface FormFieldDefinition {
  id: string;
  type: FormFieldType;
  label: string;
  placeholder?: string;
  required: boolean;
  options?: string[];
  condition?: FormFieldCondition;
  order: number;
}

export interface LeadCaptureForm {
  id: string;
  orgId: string;
  projectId?: string | null;
  name: string;
  slug: string;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  fields: FormFieldDefinition[];
  branding: {
    headline: string;
    description?: string;
    accentColor: string;
    logoUrl?: string;
  };
  consentText: string;
  successMessage: string;
  assignToAgentUid?: string | null;
  honeypotEnabled: boolean;
  rateLimitPerHour: number;
  viewsCount: number;
  submissionsCount: number;
  createdByUid: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface FormSubmission {
  id: string;
  orgId: string;
  formId: string;
  projectId?: string | null;
  values: Record<string, unknown>;
  consentAccepted: boolean;
  resultingLeadId: string;
  isDuplicate: boolean;
  ipHash: string;
  submittedAt: ISODateString;
}

// 31. integrations
export type IntegrationProvider =
  | 'OPENAI'
  | 'WHATSAPP_CLOUD'
  | 'META_LEAD_ADS'
  | 'INSTAGRAM'
  | 'GOOGLE_ADS'
  | 'RAZORPAY_COLLECTIONS'
  | 'GOOGLE_MAPS'
  | 'EMAIL';

export interface IntegrationConfig {
  id: string;
  orgId: string;
  provider: IntegrationProvider;
  status: 'NOT_CONFIGURED' | 'CONFIGURED_UNTESTED' | 'VERIFIED_ACTIVE' | 'ERROR';
  publicMetadata: Record<string, string>; // Non-secret identifiers ONLY (e.g., phoneNumberId, pageId)
  lastVerifiedAt?: ISODateString | null;
  lastWebhookAt?: ISODateString | null;
  lastError?: string | null;
  updatedByUid: string;
  updatedAt: ISODateString;
}

// 32. subscriptions, entitlements, subscription_events, invoices, payments, onboarding_orders, credit_topups, usage_ledger
export type SubscriptionLifecycleStatus =
  | 'PENDING_CHECKOUT'
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'GRACE_PERIOD'
  | 'CANCELLED_AT_PERIOD_END'
  | 'CANCELLED'
  | 'SUSPENDED';

export type WorkspaceAccessMode =
  | 'PENDING_SUBSCRIPTION'
  | 'FULL_ACCESS'
  | 'GRACE_WARNING'
  | 'READ_ONLY_SUSPENDED';

export interface Subscription {
  id: string; // `${orgId}`
  orgId: string;
  planCode: SaasPlanCode; // Strictly 'SINGLE_PROJECT' | 'MULTI_PROJECT'
  billingCycle: 'MONTHLY';
  subscribedProjectCapacity: number; // 1 for SINGLE_PROJECT; >= 2 for MULTI_PROJECT
  basePriceInr: number; // Recurring monthly subtotal before tax
  taxRatePct: number;
  monthlyTotalInr: number;
  onboardingFeePaid: boolean;
  status: SubscriptionLifecycleStatus;
  entitlements: {
    maxProjects: number; // Matches subscribedProjectCapacity (-1 only if Super Admin override)
    maxUsers: number;
    monthlyAiCredits: number;
    monthlyWhatsappQuota: number;
  };
  usageThisCycle: {
    projectsCount: number;
    activeUsersCount: number;
    aiCreditsUsed: number;
    whatsappMessagesSent: number;
  };
  addons: {
    extraUsers: number;
    extraProjects: number;
    extraAiCredits: number;
    extraWhatsappQuota: number;
  };
  razorpayPlanId?: string;
  razorpaySubscriptionId?: string;
  razorpayCustomerId?: string;
  razorpayShortUrl?: string;
  pendingPlanChange?: {
    targetPlanCode: SaasPlanCode;
    targetProjectCapacity: number;
    razorpayReplacementSubscriptionId?: string;
    retainedActiveProjectIds?: string[];
    requestedAt: ISODateString;
  } | null;
  gracePeriodEndsAt?: ISODateString | null;
  cancelAtPeriodEnd?: boolean;
  cancelledAt?: ISODateString | null;
  currentPeriodStart: ISODateString;
  currentPeriodEnd: ISODateString;
  updatedAt: ISODateString;
}

export interface TenantEntitlements {
  id: string; // `${orgId}`
  orgId: string;
  packageCode: SaasPlanCode;
  workspaceAccessMode: WorkspaceAccessMode;
  subscribedProjectCapacity: number; // Authoritative active-project limit
  activeProjectsCount: number;
  // Prepaid Wallets (Integer Paise: ₹1 = 100 Paise)
  aiBalancePaise: number;
  aiReservedPaise: number;
  whatsappBalancePaise: number;
  whatsappReservedPaise: number;
  // Explicit Super Admin enterprise credit floor (0 = negative balances strictly forbidden)
  aiOverdraftLimitPaise: number;
  whatsappOverdraftLimitPaise: number;
  lowBalanceThresholdPaise: number;
  gracePeriodEndsAt?: ISODateString | null;
  updatedAt: ISODateString;
}

export interface SubscriptionEvent {
  id: string; // Razorpay event ID or deterministic idempotency hash
  orgId: string;
  provider: 'RAZORPAY' | 'INTERNAL';
  eventType: string;
  razorpaySubscriptionId?: string | null;
  razorpayPaymentId?: string | null;
  razorpayOrderId?: string | null;
  signatureVerified: boolean;
  processed: boolean;
  processingSummary: string;
  payloadSummary?: Record<string, unknown>;
  receivedAt: ISODateString;
}

export interface SaasInvoice {
  id: string;
  orgId: string;
  invoiceNumber: string;
  subscriptionId: string;
  billingReason:
    | 'SUBSCRIPTION'
    | 'CAPACITY_UPGRADE'
    | 'ONBOARDING'
    | 'WALLET_TOPUP'
    | 'RENEWAL';
  packageCode?: SaasPlanCode;
  projectSlotsBilled?: number;
  subtotalInr: number;
  taxRatePct?: number;
  gstInr: number;
  totalInr: number;
  status: 'DRAFT' | 'ISSUED' | 'PAID' | 'FAILED' | 'VOID';
  razorpayOrderId?: string;
  razorpaySubscriptionId?: string;
  razorpayInvoiceId?: string;
  razorpayPaymentId?: string;
  razorpaySignatureVerified: boolean;
  issuedAt: ISODateString;
  paidAt?: ISODateString | null;
  pdfStoragePath?: string;
}

export interface SaasPayment {
  id: string;
  orgId: string;
  invoiceId?: string | null;
  subscriptionId?: string | null;
  onboardingOrderId?: string | null;
  topupOrderId?: string | null;
  paymentPurpose: 'SUBSCRIPTION' | 'ONBOARDING' | 'AI_WALLET_TOPUP' | 'WHATSAPP_WALLET_TOPUP';
  amountPaise: number;
  currency: 'INR';
  status: 'CREATED' | 'AUTHORIZED' | 'CAPTURED' | 'FAILED' | 'REFUNDED';
  razorpayPaymentId?: string;
  razorpayOrderId?: string;
  razorpaySubscriptionId?: string;
  signatureVerified: boolean;
  failureReason?: string | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface OnboardingOrder {
  id: string;
  idempotencyKey: string;
  orgId: string;
  serviceCode: OnboardingServiceCode;
  serviceName: string;
  subtotalInr: number;
  taxRatePct: number;
  gstInr: number;
  totalInr: number;
  status: 'FREE_SELF_SERVICE' | 'QUOTE_REQUESTED' | 'PENDING_PAYMENT' | 'PAID' | 'FAILED';
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  invoiceId?: string | null;
  requestedByUid: string;
  notes?: string;
  createdAt: ISODateString;
  paidAt?: ISODateString | null;
  updatedAt: ISODateString;
}

export type PrepaidWalletType = 'AI' | 'WHATSAPP';

export interface CreditTopupOrder {
  id: string;
  idempotencyKey: string;
  orgId: string;
  walletType: PrepaidWalletType;
  creditAmountInr: number; // Net wallet value credited upon payment (₹500, ₹2,000, ₹5,000, or custom)
  creditAmountPaise: number;
  taxRatePct: number;
  gstInr: number;
  totalPayableInr: number;
  totalPayablePaise: number;
  status: 'PENDING_PAYMENT' | 'PAID' | 'FAILED';
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  invoiceId?: string | null;
  requestedByUid: string;
  createdAt: ISODateString;
  creditedAt?: ISODateString | null;
  updatedAt: ISODateString;
}

export interface UsageLedgerEntry {
  id: string; // Deterministic ID for idempotent deduplication
  orgId: string;
  walletType: PrepaidWalletType;
  entryType:
    | 'TOPUP_CREDIT'
    | 'ADMIN_CREDIT_ADJUSTMENT'
    | 'RESERVATION_HOLD'
    | 'RESERVATION_RELEASE'
    | 'USAGE_DEBIT'
    | 'FAILED_DELIVERY_REFUND';
  amountPaise: number; // Positive magnitude in Paise
  balanceAfterPaise: number;
  reservedAfterPaise: number;
  requestId: string; // Idempotency key (AI requestId or WhatsApp waMessageId)
  actorUid?: string | null;
  // AI Billing Metadata
  aiMetadata?: {
    feature: AiFeatureTask;
    model: string;
    inputTokens: number;
    outputTokens: number;
    rateVersion: string;
  };
  // WhatsApp Billing Metadata
  whatsappMetadata?: {
    wabaOrPhoneNumberId: string;
    waMessageId: string;
    recipientMarket: string;
    messageCategory: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION' | 'SERVICE';
    deliveryEvidence: string;
    rateVersion: string;
    appliedRatePaise: number;
  };
  summary: string;
  createdAt: ISODateString;
}

export interface CustomerSavedProperty {
  id: string; // `${uid}_${unitId}`
  uid: string;
  unitId: string;
  projectId: string;
  orgId: string;
  savedAt: ISODateString;
}

// 34. ai_usage_logs
export type AiFeatureTask =
  | 'LEAD_QUALIFICATION'
  | 'BUYER_REQUIREMENT_EXTRACTION'
  | 'PROPERTY_MATCHING'
  | 'WHATSAPP_REPLY_DRAFT'
  | 'COST_SHEET_EXPLANATION'
  | 'FLOOR_PLAN_ANALYSIS'
  | 'BROCHURE_SUMMARIZATION'
  | 'PRICE_COMPARISON_EXPLANATION'
  | 'MARKET_INTELLIGENCE'
  | 'NEGOTIATION_ASSISTANCE'
  | 'SALES_PERFORMANCE_INSIGHTS'
  | 'FOLLOW_UP_RECOMMENDATIONS'
  | 'DOCUMENT_INFO_EXTRACTION'
  | 'ADMIN_NL_REPORT'
  | 'CONVERSATIONAL_ORCHESTRATION'
  | 'FLOOR_PLAN_VISION_EXTRACTION'
  | 'DOCUMENT_ESCALATION_EXTRACTION'
  | 'INTENT_CLASSIFICATION';

export interface AiUsageLog {
  id: string;
  orgId: string;
  uid: string;
  feature: AiFeatureTask;
  model: string;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  creditsConsumed: number;
  entityType?: string;
  entityId?: string;
  latencyMs: number;
  status: 'SUCCESS' | 'BUDGET_BLOCKED' | 'UNCONFIGURED' | 'ERROR';
  createdAt: ISODateString;
}

// 35. approvals
export interface ApprovalRequest {
  id: string;
  orgId: string;
  entityType:
    | 'PRICE_BOOK'
    | 'QUOTATION_DISCOUNT'
    | 'BOOKING'
    | 'BOOKING_CANCELLATION'
    | 'INVENTORY_RELEASE';
  entityId: string;
  projectId?: string | null;
  requestedByUid: string;
  requestedByName: string;
  requiredPermission: PermissionKey;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  requestSummary: string;
  payloadSnapshot: Record<string, unknown>;
  decidedByUid?: string | null;
  decisionNotes?: string;
  decidedAt?: ISODateString | null;
  createdAt: ISODateString;
}

// 36. audit_events
export type AuditCategory =
  | 'PRICING'
  | 'INVENTORY'
  | 'PARKING'
  | 'DISCOUNT'
  | 'APPROVAL'
  | 'BOOKING'
  | 'PAYMENT'
  | 'DOCUMENT'
  | 'PERMISSION'
  | 'AUTH'
  | 'BILLING'
  | 'AI'
  | 'SYSTEM';

export interface AuditEvent {
  id: string;
  orgId: string; // Tenant orgId or 'PLATFORM'
  actorUid: string;
  actorEmail?: string;
  actorRole?: string;
  action: string;
  category: AuditCategory;
  entityType: string;
  entityId: string;
  summary: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  createdAt: ISODateString;
}

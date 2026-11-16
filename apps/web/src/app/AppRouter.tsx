import * as React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { EnterpriseLayout } from '@/components/layout/EnterpriseLayout';
import { PublicPortalLayout } from '@/components/layout/PublicPortalLayout';
import {
  BuilderWorkspaceGuard,
  CustomerAuthGuard,
  PartnerWorkspaceGuard,
  SuperAdminGuard,
} from '@/components/auth/PersonaRouteGuards';
import { AuthPage } from '@/features/auth/pages/AuthPage';
import { DashboardPage } from '@/features/dashboard/pages/DashboardPage';

const ProjectsAndInventoryPage = React.lazy(() =>
  import('@/features/inventory/pages/ProjectsAndInventoryPage').then((m) => ({
    default: m.ProjectsAndInventoryPage,
  }))
);
const ParkingPage = React.lazy(() =>
  import('@/features/parking/pages/ParkingPage').then((m) => ({ default: m.ParkingPage }))
);
const PricingAndCostSheetsPage = React.lazy(() =>
  import('@/features/pricing/pages/PricingAndCostSheetsPage').then((m) => ({
    default: m.PricingAndCostSheetsPage,
  }))
);
const DocumentsPage = React.lazy(() =>
  import('@/features/documents/pages/DocumentsPage').then((m) => ({ default: m.DocumentsPage }))
);
const SharedDocumentViewPage = React.lazy(() =>
  import('@/features/documents/pages/SharedDocumentViewPage').then((m) => ({
    default: m.SharedDocumentViewPage,
  }))
);
const LeadsCrmPage = React.lazy(() =>
  import('@/features/leads/pages/LeadsCrmPage').then((m) => ({ default: m.LeadsCrmPage }))
);
const WhatsAppInboxPage = React.lazy(() =>
  import('@/features/whatsapp/pages/WhatsAppInboxPage').then((m) => ({
    default: m.WhatsAppInboxPage,
  }))
);
const ChannelPartnersPage = React.lazy(() =>
  import('@/features/channel-partners/pages/ChannelPartnersPage').then((m) => ({
    default: m.ChannelPartnersPage,
  }))
);
const PartnerPortalPage = React.lazy(() =>
  import('@/features/channel-partners/pages/PartnerPortalPage').then((m) => ({
    default: m.PartnerPortalPage,
  }))
);
const SiteVisitsPage = React.lazy(() =>
  import('@/features/visits/pages/SiteVisitsPage').then((m) => ({ default: m.SiteVisitsPage }))
);
const BookingsAndCollectionsPage = React.lazy(() =>
  import('@/features/bookings/pages/BookingsAndCollectionsPage').then((m) => ({
    default: m.BookingsAndCollectionsPage,
  }))
);
const FormBuilderPage = React.lazy(() =>
  import('@/features/forms/pages/FormBuilderPage').then((m) => ({ default: m.FormBuilderPage }))
);
const PublicHostedFormPage = React.lazy(() =>
  import('@/features/forms/pages/PublicHostedFormPage').then((m) => ({
    default: m.PublicHostedFormPage,
  }))
);
const ReportsAndAuditPage = React.lazy(() =>
  import('@/features/reports/pages/ReportsAndAuditPage').then((m) => ({
    default: m.ReportsAndAuditPage,
  }))
);
const SettingsPage = React.lazy(() =>
  import('@/features/settings/pages/SettingsPage').then((m) => ({ default: m.SettingsPage }))
);
const BuilderBillingPage = React.lazy(() =>
  import('@/features/billing/pages/BuilderBillingPage').then((m) => ({
    default: m.BuilderBillingPage,
  }))
);
const BuilderOnboardingPage = React.lazy(() =>
  import('@/features/organizations/pages/BuilderOnboardingPage').then((m) => ({
    default: m.BuilderOnboardingPage,
  }))
);
const SuperAdminConsolePage = React.lazy(() =>
  import('@/features/admin/pages/SuperAdminConsolePage').then((m) => ({
    default: m.SuperAdminConsolePage,
  }))
);
const AiInventoryStudioPage = React.lazy(() =>
  import('@/features/ai-assistant/pages/AiInventoryStudioPage').then((m) => ({
    default: m.AiInventoryStudioPage,
  }))
);
const CustomerPortalPage = React.lazy(() =>
  import('@/features/public-portal/pages/CustomerPortalPage').then((m) => ({
    default: m.CustomerPortalPage,
  }))
);

import {
  PublicAboutPage,
  PublicBookVisitPage,
  PublicContactBuilderPage,
  PublicContactPage,
  PublicForProfessionalsPage,
  PublicHomePage,
  PublicListingsCatalogPage,
  PublicPricingPage,
  PublicProjectDetailsPage,
  PublicProjectsDirectoryPage,
  PublicPropertyComparePage,
  PublicPropertyDetailsPage,
} from '@/features/public-portal/pages/PublicPortalPages';

export function AppRouter() {
  return (
    <BrowserRouter>
      <React.Suspense
        fallback={
          <div className="flex min-h-[240px] items-center justify-center text-xs text-muted-foreground">
            Loading module...
          </div>
        }
      >
        <Routes>
          {/* A. CUSTOMER & PUBLIC PROPERTY PORTAL EXPERIENCE */}
          <Route element={<PublicPortalLayout />}>
            <Route path="/" element={<PublicHomePage />} />
            <Route path="/buy" element={<PublicListingsCatalogPage mode="BUY" />} />
            <Route path="/rent" element={<PublicListingsCatalogPage mode="RENT" />} />
            <Route path="/projects" element={<PublicProjectsDirectoryPage />} />
            <Route path="/project/:slug" element={<PublicProjectDetailsPage />} />
            <Route path="/projects/:projectId" element={<PublicProjectDetailsPage />} />
            <Route path="/property/:slug" element={<PublicPropertyDetailsPage />} />
            <Route path="/properties/:unitId" element={<PublicPropertyDetailsPage />} />
            <Route path="/compare" element={<PublicPropertyComparePage />} />
            <Route path="/book-visit" element={<PublicBookVisitPage />} />
            <Route path="/contact-builder/:orgId" element={<PublicContactBuilderPage />} />
            <Route path="/for-professionals" element={<PublicForProfessionalsPage />} />
            <Route path="/pricing" element={<PublicPricingPage />} />
            <Route path="/about" element={<PublicAboutPage />} />
            <Route path="/contact" element={<PublicContactPage />} />

            {/* Authenticated Personal Customer Routes */}
            <Route element={<CustomerAuthGuard />}>
              <Route path="/saved" element={<CustomerPortalPage section="saved" />} />
              <Route path="/my-enquiries" element={<CustomerPortalPage section="enquiries" />} />
              <Route path="/my-visits" element={<CustomerPortalPage section="visits" />} />
            </Route>
          </Route>

          {/* Authentication, Hosted Forms & Expiring Document Share Links */}
          <Route path="/login" element={<AuthPage defaultMode="login" />} />
          <Route path="/register" element={<AuthPage defaultMode="register" />} />
          <Route path="/auth/login" element={<AuthPage defaultMode="login" />} />
          <Route path="/auth/register" element={<AuthPage defaultMode="register" />} />
          <Route path="/f/:formSlug" element={<PublicHostedFormPage />} />
          <Route path="/share/doc/:tokenId" element={<SharedDocumentViewPage />} />

          {/* B. BUILDER WORKSPACE EXPERIENCE */}
          <Route
            path="/builder/onboarding"
            element={
              <BuilderWorkspaceGuard allowOnboardingWithoutOrg>
                <BuilderOnboardingPage />
              </BuilderWorkspaceGuard>
            }
          />

          <Route
            path="/builder"
            element={
              <BuilderWorkspaceGuard>
                <EnterpriseLayout />
              </BuilderWorkspaceGuard>
            }
          >
            <Route index element={<Navigate to="/builder/dashboard" replace />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="projects" element={<ProjectsAndInventoryPage />} />
            <Route path="projects/:id" element={<ProjectsAndInventoryPage />} />
            <Route path="inventory" element={<ProjectsAndInventoryPage />} />
            <Route path="parking" element={<ParkingPage />} />
            <Route path="pricing" element={<PricingAndCostSheetsPage />} />
            <Route path="cost-sheets" element={<PricingAndCostSheetsPage />} />
            <Route path="quotations" element={<PricingAndCostSheetsPage />} />
            <Route path="leads" element={<LeadsCrmPage />} />
            <Route path="forms" element={<FormBuilderPage />} />
            <Route path="inbox" element={<WhatsAppInboxPage />} />
            <Route path="channel-partners" element={<ChannelPartnersPage />} />
            <Route path="visits" element={<SiteVisitsPage />} />
            <Route path="bookings" element={<BookingsAndCollectionsPage />} />
            <Route path="collections" element={<BookingsAndCollectionsPage />} />
            <Route path="documents" element={<DocumentsPage />} />
            <Route path="ai-assistant" element={<AiInventoryStudioPage />} />
            <Route path="ai-studio" element={<AiInventoryStudioPage />} />
            <Route path="reports" element={<ReportsAndAuditPage />} />
            <Route path="team" element={<SettingsPage defaultTab="team" />} />
            <Route path="billing" element={<BuilderBillingPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/builder/dashboard" replace />} />
          </Route>

          {/* Backwards-compatible /app/* Builder aliases (guarded identically) */}
          <Route
            path="/app"
            element={
              <BuilderWorkspaceGuard>
                <EnterpriseLayout />
              </BuilderWorkspaceGuard>
            }
          >
            <Route index element={<Navigate to="/builder/dashboard" replace />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="projects" element={<ProjectsAndInventoryPage />} />
            <Route path="inventory" element={<ProjectsAndInventoryPage />} />
            <Route path="parking" element={<ParkingPage />} />
            <Route path="pricing" element={<PricingAndCostSheetsPage />} />
            <Route path="quotations" element={<PricingAndCostSheetsPage />} />
            <Route path="leads" element={<LeadsCrmPage />} />
            <Route path="forms" element={<FormBuilderPage />} />
            <Route path="inbox" element={<WhatsAppInboxPage />} />
            <Route path="channel-partners" element={<ChannelPartnersPage />} />
            <Route path="visits" element={<SiteVisitsPage />} />
            <Route path="bookings" element={<BookingsAndCollectionsPage />} />
            <Route path="documents" element={<DocumentsPage />} />
            <Route path="reports" element={<ReportsAndAuditPage />} />
            <Route path="billing" element={<BuilderBillingPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="ai-studio" element={<AiInventoryStudioPage />} />
            <Route path="ai-assistant" element={<AiInventoryStudioPage />} />
            <Route path="*" element={<Navigate to="/builder/dashboard" replace />} />
          </Route>

          {/* C. CHANNEL PARTNER EXPERIENCE */}
          <Route path="/partner" element={<PartnerWorkspaceGuard />}>
            <Route index element={<Navigate to="/partner/dashboard" replace />} />
            <Route path="dashboard" element={<PartnerPortalPage activeSection="dashboard" />} />
            <Route path="builders" element={<PartnerPortalPage activeSection="builders" />} />
            <Route path="projects" element={<PartnerPortalPage activeSection="projects" />} />
            <Route path="inventory" element={<PartnerPortalPage activeSection="inventory" />} />
            <Route path="leads" element={<PartnerPortalPage activeSection="leads" />} />
            <Route path="visits" element={<PartnerPortalPage activeSection="visits" />} />
            <Route path="quotations" element={<PartnerPortalPage activeSection="quotations" />} />
            <Route path="commissions" element={<PartnerPortalPage activeSection="commissions" />} />
            <Route path="profile" element={<PartnerPortalPage activeSection="profile" />} />
            <Route path="*" element={<Navigate to="/partner/dashboard" replace />} />
          </Route>

          {/* D. PLATFORM SUPER ADMIN EXPERIENCE */}
          <Route path="/admin" element={<SuperAdminGuard />}>
            <Route index element={<Navigate to="/admin/dashboard" replace />} />
            <Route path="dashboard" element={<SuperAdminConsolePage activeSection="dashboard" />} />
            <Route path="builders" element={<SuperAdminConsolePage activeSection="builders" />} />
            <Route
              path="organizations"
              element={<SuperAdminConsolePage activeSection="organizations" />}
            />
            <Route path="projects" element={<SuperAdminConsolePage activeSection="projects" />} />
            <Route path="users" element={<SuperAdminConsolePage activeSection="users" />} />
            <Route
              path="subscriptions"
              element={<SuperAdminConsolePage activeSection="subscriptions" />}
            />
            <Route path="payments" element={<SuperAdminConsolePage activeSection="payments" />} />
            <Route path="credits" element={<SuperAdminConsolePage activeSection="credits" />} />
            <Route
              path="integrations"
              element={<SuperAdminConsolePage activeSection="integrations" />}
            />
            <Route path="audit" element={<SuperAdminConsolePage activeSection="audit" />} />
            <Route path="settings" element={<SuperAdminConsolePage activeSection="settings" />} />
            <Route path="*" element={<Navigate to="/admin/dashboard" replace />} />
          </Route>

          <Route path="/super-admin/*" element={<Navigate to="/admin/dashboard" replace />} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </React.Suspense>
    </BrowserRouter>
  );
}

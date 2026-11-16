import * as React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { EnterpriseLayout } from '@/components/layout/EnterpriseLayout';
import { PublicPortalLayout } from '@/components/layout/PublicPortalLayout';
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
          {/* Public Property Portal Routes */}
          <Route element={<PublicPortalLayout />}>
            <Route path="/" element={<PublicHomePage />} />
            <Route path="/buy" element={<PublicListingsCatalogPage mode="BUY" />} />
            <Route path="/rent" element={<PublicListingsCatalogPage mode="RENT" />} />
            <Route path="/projects" element={<PublicProjectsDirectoryPage />} />
            <Route path="/projects/:projectId" element={<PublicProjectDetailsPage />} />
            <Route path="/properties/:unitId" element={<PublicPropertyDetailsPage />} />
            <Route path="/compare" element={<PublicPropertyComparePage />} />
            <Route path="/book-visit" element={<PublicBookVisitPage />} />
            <Route path="/contact-builder/:orgId" element={<PublicContactBuilderPage />} />
            <Route path="/for-professionals" element={<PublicForProfessionalsPage />} />
            <Route path="/pricing" element={<PublicPricingPage />} />
            <Route path="/about" element={<PublicAboutPage />} />
            <Route path="/contact" element={<PublicContactPage />} />
          </Route>

          {/* Auth, Hosted Forms, Expiring Document Links, Partner Portal & Super Admin */}
          <Route path="/auth/login" element={<AuthPage defaultMode="login" />} />
          <Route path="/auth/register" element={<AuthPage defaultMode="register" />} />
          <Route path="/f/:formSlug" element={<PublicHostedFormPage />} />
          <Route path="/share/doc/:tokenId" element={<SharedDocumentViewPage />} />
          <Route path="/partner/*" element={<PartnerPortalPage />} />
          <Route path="/super-admin/*" element={<SuperAdminConsolePage />} />

          {/* Enterprise Real Estate Management Workspace (Strictly 12 Primary Modules) */}
          <Route path="/app" element={<EnterpriseLayout />}>
            <Route index element={<Navigate to="/app/dashboard" replace />} />
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
            <Route path="settings" element={<SettingsPage />} />
            <Route path="ai-studio" element={<AiInventoryStudioPage />} />
            <Route path="*" element={<DashboardPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </React.Suspense>
    </BrowserRouter>
  );
}

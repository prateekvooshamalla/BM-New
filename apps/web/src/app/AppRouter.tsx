import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { EnterpriseLayout } from '@/components/layout/EnterpriseLayout';
import { PublicPortalLayout } from '@/components/layout/PublicPortalLayout';
import { AuthPage } from '@/features/auth/pages/AuthPage';
import { DashboardPage } from '@/features/dashboard/pages/DashboardPage';
import { ProjectsAndInventoryPage } from '@/features/inventory/pages/ProjectsAndInventoryPage';
import { ParkingPage } from '@/features/parking/pages/ParkingPage';
import { PricingAndCostSheetsPage } from '@/features/pricing/pages/PricingAndCostSheetsPage';
import { DocumentsPage } from '@/features/documents/pages/DocumentsPage';
import { LeadsCrmPage } from '@/features/leads/pages/LeadsCrmPage';
import { WhatsAppInboxPage } from '@/features/whatsapp/pages/WhatsAppInboxPage';
import { ChannelPartnersPage } from '@/features/channel-partners/pages/ChannelPartnersPage';
import { PartnerPortalPage } from '@/features/channel-partners/pages/PartnerPortalPage';
import { SiteVisitsPage } from '@/features/visits/pages/SiteVisitsPage';
import { BookingsAndCollectionsPage } from '@/features/bookings/pages/BookingsAndCollectionsPage';
import { FormBuilderPage } from '@/features/forms/pages/FormBuilderPage';
import { PublicHostedFormPage } from '@/features/forms/pages/PublicHostedFormPage';
import { SettingsPage } from '@/features/settings/pages/SettingsPage';
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

        {/* Auth, Hosted Lead Forms & Channel Partner Portal */}
        <Route path="/auth/login" element={<AuthPage defaultMode="login" />} />
        <Route path="/auth/register" element={<AuthPage defaultMode="register" />} />
        <Route path="/f/:formSlug" element={<PublicHostedFormPage />} />
        <Route path="/partner/*" element={<PartnerPortalPage />} />

        {/* Enterprise Real Estate Management Workspace */}
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
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<DashboardPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

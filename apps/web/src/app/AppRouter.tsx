import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { EnterpriseLayout } from '@/components/layout/EnterpriseLayout';
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

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/auth/login" element={<AuthPage defaultMode="login" />} />
        <Route path="/auth/register" element={<AuthPage defaultMode="register" />} />
        <Route path="/partner/*" element={<PartnerPortalPage />} />
        <Route path="/f/:formSlug" element={<PublicHostedFormPage />} />

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

        <Route path="*" element={<Navigate to="/app/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { EnterpriseLayout } from '@/components/layout/EnterpriseLayout';
import { AuthPage } from '@/features/auth/pages/AuthPage';
import { DashboardPage } from '@/features/dashboard/pages/DashboardPage';
import { ProjectsAndInventoryPage } from '@/features/inventory/pages/ProjectsAndInventoryPage';
import { ParkingPage } from '@/features/parking/pages/ParkingPage';
import { SettingsPage } from '@/features/settings/pages/SettingsPage';

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/auth/login" element={<AuthPage defaultMode="login" />} />
        <Route path="/auth/register" element={<AuthPage defaultMode="register" />} />

        <Route path="/app" element={<EnterpriseLayout />}>
          <Route index element={<Navigate to="/app/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="projects" element={<ProjectsAndInventoryPage />} />
          <Route path="inventory" element={<ProjectsAndInventoryPage />} />
          <Route path="parking" element={<ParkingPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<DashboardPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/app/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

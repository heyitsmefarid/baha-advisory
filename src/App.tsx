import React, { lazy, Suspense } from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import { PlatformProvider } from "./contexts/PlatformContext";
import { GeographicScopeProvider } from "./contexts/GeographicScopeContext";
import { ToastProvider, Spinner } from "./components/ui";
import { PrivateRoute, RequireLegacyAdmin, RequireRole } from "./components/RouteGuards";
import PublicMapPage from "./pages/PublicMapPage";
import { useDraftSync } from "./hooks/useDraftSync";
import { useAlertWatcher } from "./hooks/useAlertWatcher";
import { useOfflineSnapshot } from "./hooks/useOfflineSnapshot";

// Public map is eager (it's the landing page); everything else is split
// into its own chunk so the first paint on a slow connection stays small.
const AdvisoriesPage = lazy(() => import("./pages/AdvisoriesPage"));
const NavigatePage = lazy(() => import("./pages/NavigatePage"));
const ReportPage = lazy(() => import("./pages/ReportPage"));
const EvacuationPage = lazy(() => import("./pages/EvacuationPage"));
const VerificationPage = lazy(() => import("./pages/admin/VerificationPage"));
const EvacuationAdminPage = lazy(() => import("./pages/admin/EvacuationAdminPage"));
const SosQueuePage = lazy(() => import("./pages/admin/SosQueuePage"));
const RoadsAdminPage = lazy(() => import("./pages/admin/RoadsAdminPage"));
const AssistantPage = lazy(() => import("./pages/AssistantPage"));
const AdvisoriesAdminPage = lazy(() => import("./pages/admin/AdvisoriesAdminPage"));
const RiskPage = lazy(() => import("./pages/RiskPage"));
const AlertsPage = lazy(() => import("./pages/AlertsPage"));
const OfflineKitPage = lazy(() => import("./pages/OfflineKitPage"));
const WaterLevelsPage = lazy(() => import("./pages/admin/WaterLevelsPage"));
const PricingPage = lazy(() => import("./pages/PricingPage"));
const GetStartedPage = lazy(() => import("./pages/GetStartedPage"));
const AccountPage = lazy(() => import("./pages/AccountPage"));
const CheckoutDemoPage = lazy(() => import("./pages/billing/CheckoutDemoPage"));
const BillingReturnPage = lazy(() => import("./pages/billing/BillingReturnPage"));
const InvoicePage = lazy(() => import("./pages/billing/InvoicePage"));
const OrgBillingPage = lazy(() => import("./pages/org/OrgPages").then((m) => ({ default: m.BillingPage })));
const OrgStaffPage = lazy(() => import("./pages/org/OrgPages").then((m) => ({ default: m.StaffPage })));
const BusinessOverviewPage = lazy(() => import("./pages/business/BusinessPages").then((m) => ({ default: m.BusinessOverviewPage })));
const SavedRoutesPage = lazy(() => import("./pages/business/BusinessPages").then((m) => ({ default: m.SavedRoutesPage })));
const DisruptionsPage = lazy(() => import("./pages/business/BusinessPages").then((m) => ({ default: m.DisruptionsPage })));
const BusinessAnalyticsPage = lazy(() => import("./pages/business/BusinessPages").then((m) => ({ default: m.BusinessAnalyticsPage })));
const RoutePlannerPage = lazy(() => import("./pages/business/RoutePlannerPage"));
const BusinessModelPage = lazy(() => import("./pages/BusinessModelPage"));
const DemoGuidePage = lazy(() => import("./pages/DemoGuidePage"));
const AnalyticsPage = lazy(() => import("./pages/admin/AnalyticsPage"));
const SuperOverviewPage = lazy(() => import("./pages/super/SuperPages").then((m) => ({ default: m.SuperOverviewPage })));
const RevenuePage = lazy(() => import("./pages/super/SuperPages").then((m) => ({ default: m.RevenuePage })));
const OrganizationsPage = lazy(() => import("./pages/super/SuperPages").then((m) => ({ default: m.OrganizationsPage })));
const SuperUsersPage = lazy(() => import("./pages/super/SuperPages").then((m) => ({ default: m.SuperUsersPage })));
const SubscriptionsPage = lazy(() => import("./pages/super/SuperPages").then((m) => ({ default: m.SubscriptionsPage })));
const PlansPage = lazy(() => import("./pages/super/SuperPages").then((m) => ({ default: m.PlansPage })));
const AiUsagePage = lazy(() => import("./pages/super/SuperPages").then((m) => ({ default: m.AiUsagePage })));
const SettingsPage = lazy(() => import("./pages/super/SuperPages").then((m) => ({ default: m.SettingsPage })));
const SuperAuditPage = lazy(() => import("./pages/super/SuperPages").then((m) => ({ default: m.SuperAuditPage })));
const EnterpriseOverviewPage = lazy(() => import("./pages/enterprise/EnterprisePages").then((m) => ({ default: m.EnterpriseOverviewPage })));
const BranchesPage = lazy(() => import("./pages/enterprise/EnterprisePages").then((m) => ({ default: m.BranchesPage })));
const ApiAccessPage = lazy(() => import("./pages/enterprise/EnterprisePages").then((m) => ({ default: m.ApiAccessPage })));
const CustomReportsPage = lazy(() => import("./pages/enterprise/EnterprisePages").then((m) => ({ default: m.CustomReportsPage })));
const Login = lazy(() => import("./pages/Login"));
const RegisterPage = lazy(() => import("./pages/auth/RegisterPage"));
const ResetPasswordPage = lazy(() => import("./pages/auth/ResetPasswordPage"));
const ForbiddenPage = lazy(() => import("./pages/ForbiddenPage"));
const DashboardPage = lazy(() => import("./pages/admin/DashboardPage"));
const ManageMapPage = lazy(() => import("./pages/admin/ManageMapPage"));
const IncidentsPage = lazy(() => import("./pages/admin/IncidentsPage"));
const UsersPage = lazy(() => import("./pages/admin/UsersPage"));
const AuditLogsPage = lazy(() => import("./pages/admin/AuditLogsPage"));

const LGU = ["lgu_staff", "lgu_admin"] as const;
const BUSINESS = ["business_staff", "business_admin", "enterprise_admin"] as const;

/**
 * App-wide background work: sends offline report drafts when connectivity
 * returns, watches public alerts near the person's places, and keeps the
 * offline safety kit up to date.
 */
function BackgroundSync() {
  useDraftSync();
  useAlertWatcher();
  useOfflineSnapshot();
  return null;
}

function PageFallback() {
  return (
    <div className="page-fallback">
      <Spinner label="Loading page" />
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <PlatformProvider>
          <ToastProvider>
            <BackgroundSync />
            <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
              <GeographicScopeProvider>
                <Suspense fallback={<PageFallback />}>
                  <Routes>
                  {/* Public — no login required. Public-safety features are never gated. */}
                  <Route path="/" element={<PublicMapPage />} />
                  <Route path="/advisories" element={<AdvisoriesPage />} />
                  <Route path="/navigate" element={<NavigatePage />} />
                  <Route path="/report" element={<ReportPage />} />
                  <Route path="/evacuation" element={<EvacuationPage />} />
                  <Route path="/assistant" element={<AssistantPage />} />
                  <Route path="/risk" element={<RiskPage />} />
                  <Route path="/alerts" element={<AlertsPage />} />
                  <Route path="/offline" element={<OfflineKitPage />} />
                  <Route path="/pricing" element={<PricingPage />} />
                  <Route path="/business-model" element={<BusinessModelPage />} />
                  <Route path="/demo" element={<DemoGuidePage />} />
                  <Route path="/get-started" element={<GetStartedPage />} />
                  <Route path="/me" element={<AccountPage />} />
                  <Route path="/checkout/demo/:txId" element={<PrivateRoute><CheckoutDemoPage /></PrivateRoute>} />
                  <Route path="/billing/return" element={<PrivateRoute><BillingReturnPage /></PrivateRoute>} />
                  <Route path="/billing/invoice/:id" element={<PrivateRoute><InvoicePage /></PrivateRoute>} />
                  <Route path="/login" element={<Login />} />
                  <Route path="/register" element={<RegisterPage />} />
                  <Route path="/reset-password" element={<ResetPasswordPage />} />
                  <Route path="/forbidden" element={<ForbiddenPage />} />

                  {/* LGU (original DRRM editor + admin) */}
                  <Route path="/admin" element={<RequireRole allow={[...LGU]}><DashboardPage /></RequireRole>} />
                  <Route path="/admin/manage-map" element={<RequireRole allow={[...LGU]}><ManageMapPage /></RequireRole>} />
                  <Route path="/admin/incidents" element={<RequireRole allow={[...LGU]}><IncidentsPage /></RequireRole>} />
                  <Route path="/admin/verification" element={<RequireRole allow={[...LGU]}><VerificationPage /></RequireRole>} />
                  <Route path="/admin/evacuation" element={<RequireRole allow={[...LGU]}><EvacuationAdminPage /></RequireRole>} />
                  <Route path="/admin/sos" element={<RequireRole allow={[...LGU]}><SosQueuePage /></RequireRole>} />
                  <Route path="/admin/roads" element={<RequireRole allow={[...LGU]}><RoadsAdminPage /></RequireRole>} />
                  <Route path="/admin/advisories" element={<RequireRole allow={[...LGU]}><AdvisoriesAdminPage /></RequireRole>} />
                  <Route path="/admin/water-levels" element={<RequireRole allow={[...LGU]}><WaterLevelsPage /></RequireRole>} />
                  <Route path="/admin/analytics" element={<RequireRole allow={[...LGU]}><AnalyticsPage /></RequireRole>} />
                  <Route path="/admin/staff" element={<RequireRole allow={["lgu_admin"]}><OrgStaffPage kind="lgu" /></RequireRole>} />
                  <Route path="/admin/billing" element={<RequireRole allow={["lgu_admin"]}><OrgBillingPage kind="lgu" /></RequireRole>} />

                  {/* Business Pro */}
                  <Route path="/business" element={<RequireRole allow={[...BUSINESS]}><BusinessOverviewPage /></RequireRole>} />
                  <Route path="/business/planner" element={<RequireRole allow={[...BUSINESS]}><RoutePlannerPage /></RequireRole>} />
                  <Route path="/business/routes" element={<RequireRole allow={[...BUSINESS]}><SavedRoutesPage /></RequireRole>} />
                  <Route path="/business/disruptions" element={<RequireRole allow={[...BUSINESS]}><DisruptionsPage /></RequireRole>} />
                  <Route path="/business/analytics" element={<RequireRole allow={[...BUSINESS]}><BusinessAnalyticsPage /></RequireRole>} />
                  <Route path="/business/staff" element={<RequireRole allow={["business_admin"]}><OrgStaffPage kind="business" /></RequireRole>} />
                  <Route path="/business/billing" element={<RequireRole allow={["business_admin"]}><OrgBillingPage kind="business" /></RequireRole>} />

                  {/* Enterprise */}
                  <Route path="/enterprise" element={<RequireRole allow={["enterprise_admin"]}><EnterpriseOverviewPage /></RequireRole>} />
                  <Route path="/enterprise/branches" element={<RequireRole allow={["enterprise_admin"]}><BranchesPage /></RequireRole>} />
                  <Route path="/enterprise/api" element={<RequireRole allow={["enterprise_admin", "business_admin"]}><ApiAccessPage /></RequireRole>} />
                  <Route path="/enterprise/reports" element={<RequireRole allow={["enterprise_admin"]}><CustomReportsPage /></RequireRole>} />
                  <Route path="/enterprise/staff" element={<RequireRole allow={["enterprise_admin"]}><OrgStaffPage kind="enterprise" /></RequireRole>} />
                  <Route path="/enterprise/billing" element={<RequireRole allow={["enterprise_admin"]}><OrgBillingPage kind="enterprise" /></RequireRole>} />
                  <Route path="/admin/users" element={<RequireLegacyAdmin><UsersPage /></RequireLegacyAdmin>} />
                  <Route path="/admin/audit-logs" element={<RequireRole allow={["lgu_admin"]}><AuditLogsPage /></RequireRole>} />

                  {/* Platform Super Admin */}
                  <Route path="/super" element={<RequireRole allow={["super_admin"]}><SuperOverviewPage /></RequireRole>} />
                  <Route path="/super/revenue" element={<RequireRole allow={["super_admin"]}><RevenuePage /></RequireRole>} />
                  <Route path="/super/organizations" element={<RequireRole allow={["super_admin"]}><OrganizationsPage /></RequireRole>} />
                  <Route path="/super/users" element={<RequireRole allow={["super_admin"]}><SuperUsersPage /></RequireRole>} />
                  <Route path="/super/subscriptions" element={<RequireRole allow={["super_admin"]}><SubscriptionsPage /></RequireRole>} />
                  <Route path="/super/plans" element={<RequireRole allow={["super_admin"]}><PlansPage /></RequireRole>} />
                  <Route path="/super/ai" element={<RequireRole allow={["super_admin"]}><AiUsagePage /></RequireRole>} />
                  <Route path="/super/settings" element={<RequireRole allow={["super_admin"]}><SettingsPage /></RequireRole>} />
                  <Route path="/super/audit-logs" element={<RequireRole allow={["super_admin"]}><SuperAuditPage /></RequireRole>} />

                  <Route path="*" element={<ForbiddenPage notFound />} />
                  </Routes>
                </Suspense>
              </GeographicScopeProvider>
            </Router>
          </ToastProvider>
        </PlatformProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

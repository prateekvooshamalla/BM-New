import * as React from 'react';
import { doc, onSnapshot, updateDoc, collection, query, where } from 'firebase/firestore';
import { multiFactor, TotpMultiFactorGenerator } from 'firebase/auth';
import { Link, useSearchParams } from 'react-router-dom';
import { Building2, CreditCard, Plug, ShieldCheck, Sliders, Users, Wallet } from 'lucide-react';
import { DEFAULT_SAAS_PLANS } from '@bharat-makaan/config';
import { formatInr, type IntegrationConfig, type Subscription } from '@bharat-makaan/shared';
import { auth, db } from '@/lib/firebase';
import { useTenantStore } from '@/state/useTenantStore';
import { PageHeader } from '@/components/shared/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { StaffManagementPanel } from '@/features/organizations/components/StaffManagementPanel';

const PROVIDERS = [
  { id: 'OPENAI', label: 'OpenAI Official API', desc: 'Lead qualification, cost-sheet explanations, document extraction & NL reports.' },
  { id: 'WHATSAPP_CLOUD', label: 'Meta WhatsApp Cloud API', desc: 'Shared inbox, 24h customer-service window, approved templates & reminders.' },
  { id: 'META_LEAD_ADS', label: 'Facebook & Instagram Lead Ads', desc: 'Real-time HMAC-verified webhook lead ingestion.' },
  { id: 'GOOGLE_ADS', label: 'Google Ads Lead Form Webhook', desc: 'Authenticated campaign lead capture & attribution.' },
  { id: 'RAZORPAY_COLLECTIONS', label: 'Razorpay Payment Gateway', desc: 'Verified online token/milestone collections & webhook signature reconciliation.' },
  { id: 'GOOGLE_MAPS', label: 'Google Maps & Places API', desc: 'Project coordinates, locality autocomplete & interactive public portal maps.' },
  { id: 'EMAIL', label: 'Transactional Email Provider', desc: 'Quotation PDF delivery, staff invitations & demand reminders.' },
] as const;

export function SettingsPage({ defaultTab = 'organization' }: { defaultTab?: string } = {}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || defaultTab;

  const { activeOrgId, activeOrganization, activeEntitlements, mfaEnrolledCount } =
    useTenantStore();
  const [subscription, setSubscription] = React.useState<Subscription | null>(null);
  const [integrations, setIntegrations] = React.useState<IntegrationConfig[]>([]);

  // Org editable settings
  const [orgName, setOrgName] = React.useState('');
  const [orgCity, setOrgCity] = React.useState('');
  const [orgRera, setOrgRera] = React.useState('');
  const [leadProtectionDays, setLeadProtectionDays] = React.useState(60);
  const [whatsappAutoSendAi, setWhatsappAutoSendAi] = React.useState(false);
  const [saveMessage, setSaveMessage] = React.useState<string | null>(null);

  // TOTP MFA state
  const [totpSecretUri, setTotpSecretUri] = React.useState<string | null>(null);
  const [totpSecretObj, setTotpSecretObj] = React.useState<any>(null);
  const [totpVerifyCode, setTotpVerifyCode] = React.useState('');
  const [mfaStatusMsg, setMfaStatusMsg] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (activeOrganization) {
      setOrgName(activeOrganization.name);
      setOrgCity(activeOrganization.headquartersCity);
      setOrgRera(activeOrganization.reraNumber ?? '');
      setLeadProtectionDays(activeOrganization.leadProtectionDays ?? 60);
      setWhatsappAutoSendAi(Boolean(activeOrganization.whatsappAutoSendAi));
    }
  }, [activeOrganization]);

  React.useEffect(() => {
    if (!activeOrgId) return;
    const unsubSub = onSnapshot(doc(db, 'subscriptions', activeOrgId), (snap) => {
      setSubscription(snap.exists() ? (snap.data() as Subscription) : null);
    });
    const unsubInt = onSnapshot(
      query(collection(db, 'integrations'), where('orgId', '==', activeOrgId)),
      (snap) => {
        setIntegrations(snap.docs.map((d) => d.data() as IntegrationConfig));
      }
    );
    return () => {
      unsubSub();
      unsubInt();
    };
  }, [activeOrgId]);

  const handleSaveOrgProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrgId) return;
    setSaveMessage(null);
    try {
      await updateDoc(doc(db, 'organizations', activeOrgId), {
        name: orgName.trim(),
        headquartersCity: orgCity.trim(),
        reraNumber: orgRera.trim(),
        leadProtectionDays: Number(leadProtectionDays),
        whatsappAutoSendAi,
        updatedAt: new Date().toISOString(),
      });
      setSaveMessage('Organization settings saved to Firestore.');
    } catch (err) {
      setSaveMessage(err instanceof Error ? err.message : 'Failed to save organization settings.');
    }
  };

  const startTotpEnrollment = async () => {
    setMfaStatusMsg(null);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Sign in required to configure MFA.');
      const session = await multiFactor(user).getSession();
      const secret = await TotpMultiFactorGenerator.generateSecret(session);
      const uri = secret.generateQrCodeUrl(user.email || 'admin@bharatmakaan.com', 'Bharat Makaan');
      setTotpSecretObj(secret);
      setTotpSecretUri(uri);
    } catch (err) {
      setMfaStatusMsg(
        err instanceof Error
          ? err.message
          : 'Enable Identity Platform TOTP MFA in Firebase Console to enroll authenticator app.'
      );
    }
  };

  const finalizeTotpEnrollment = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const user = auth.currentUser;
      if (!user || !totpSecretObj) return;
      const assertion = TotpMultiFactorGenerator.assertionForEnrollment(
        totpSecretObj,
        totpVerifyCode.trim()
      );
      await multiFactor(user).enroll(assertion, 'Authenticator App');
      setTotpSecretUri(null);
      setMfaStatusMsg('Authenticator MFA enrolled successfully.');
    } catch (err) {
      setMfaStatusMsg(err instanceof Error ? err.message : 'Invalid verification code.');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Governance & Administration"
        title="Organization Settings"
        description="Manage builder profile, staff permissions, lead-protection rules, external provider connections, SaaS billing, and account security."
      />

      <Tabs
        value={activeTab}
        onValueChange={(val) => setSearchParams({ tab: val })}
      >
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="organization">
            <Building2 className="mr-1.5 h-3.5 w-3.5" />
            Organization
          </TabsTrigger>
          <TabsTrigger value="team">
            <Users className="mr-1.5 h-3.5 w-3.5" />
            Team & Permissions
          </TabsTrigger>
          <TabsTrigger value="policies">
            <Sliders className="mr-1.5 h-3.5 w-3.5" />
            Policies & Automation
          </TabsTrigger>
          <TabsTrigger value="integrations">
            <Plug className="mr-1.5 h-3.5 w-3.5" />
            Integrations
          </TabsTrigger>
          <TabsTrigger value="billing">
            <CreditCard className="mr-1.5 h-3.5 w-3.5" />
            SaaS Subscription
          </TabsTrigger>
          <TabsTrigger value="security">
            <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
            Security & MFA
          </TabsTrigger>
        </TabsList>

        <TabsContent value="organization">
          <Card>
            <CardHeader>
              <CardTitle>Builder Organization Profile</CardTitle>
              <CardDescription>
                Corporate identity used across quotations, RERA disclosures, and customer documents.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {activeOrganization ? (
                <form onSubmit={handleSaveOrgProfile} className="space-y-4 max-w-2xl">
                  {saveMessage && (
                    <div className="rounded-md border border-border bg-secondary px-3 py-2 text-xs">
                      {saveMessage}
                    </div>
                  )}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>Builder Display Name</Label>
                      <Input value={orgName} onChange={(e) => setOrgName(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Headquarters City</Label>
                      <Input value={orgCity} onChange={(e) => setOrgCity(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Corporate RERA Number</Label>
                      <Input value={orgRera} onChange={(e) => setOrgRera(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Legal Entity (Immutable)</Label>
                      <Input value={activeOrganization.legalName} disabled />
                    </div>
                  </div>
                  <Button type="submit" size="sm">
                    Save Organization Profile
                  </Button>
                </form>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Create or select a builder organization from the left sidebar to configure corporate details.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="team">
          <StaffManagementPanel />
        </TabsContent>

        <TabsContent value="policies">
          <Card>
            <CardHeader>
              <CardTitle>Channel Partner Lead Protection & AI Messaging Governance</CardTitle>
              <CardDescription>
                Configure conflict-prevention windows and human-in-the-loop AI messaging safeguards.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5 max-w-2xl">
              <div className="space-y-1.5">
                <Label>Channel Partner Lead Protection Window (Days)</Label>
                <Input
                  type="number"
                  min={1}
                  max={365}
                  value={leadProtectionDays}
                  onChange={(e) => setLeadProtectionDays(Number(e.target.value))}
                />
                <p className="text-[11px] text-muted-foreground">
                  During this window, duplicate partner submissions cannot override original ownership and are flagged for conflict resolution.
                </p>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border p-4">
                <div className="space-y-0.5 pr-4">
                  <div className="text-sm font-medium">Require Human Approval for AI WhatsApp Replies</div>
                  <div className="text-xs text-muted-foreground">
                    By default, OpenAI reply drafts are queued as pending human approval. Only enable automatic sending if explicitly authorized.
                  </div>
                </div>
                <Switch
                  checked={!whatsappAutoSendAi}
                  onCheckedChange={(humanGate) => setWhatsappAutoSendAi(!humanGate)}
                />
              </div>

              <Button onClick={handleSaveOrgProfile} size="sm" disabled={!activeOrgId}>
                Save Governance Policies
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="integrations">
          <div className="grid gap-4 md:grid-cols-2">
            {PROVIDERS.map((prov) => {
              const rec = integrations.find((i) => i.provider === prov.id);
              const status = rec?.status ?? 'NOT_CONFIGURED';
              return (
                <Card key={prov.id}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm">{prov.label}</CardTitle>
                      <StatusBadge status={status} />
                    </div>
                    <CardDescription>{prov.desc}</CardDescription>
                  </CardHeader>
                  <CardContent className="text-xs text-muted-foreground space-y-2">
                    <div>
                      Secrets are strictly isolated in backend environment / Firebase Secret Manager
                      and never stored in browser-accessible documents.
                    </div>
                    {rec?.lastVerifiedAt && (
                      <div>Last verified: {new Date(rec.lastVerifiedAt).toLocaleString()}</div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="billing">
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <CardTitle>
                      Active Package:{' '}
                      {activeEntitlements?.packageCode ?? subscription?.planCode ?? 'SINGLE_PROJECT'}
                    </CardTitle>
                    <CardDescription>
                      Workspace Mode:{' '}
                      {activeEntitlements?.workspaceAccessMode ?? 'ACTIVE'} •{' '}
                      {subscription
                        ? `Renews ${new Date(subscription.currentPeriodEnd).toLocaleDateString()}`
                        : 'Monthly Razorpay Subscription'}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    {subscription && <StatusBadge status={subscription.status} />}
                    <Button size="sm" asChild>
                      <Link to="/builder/billing">
                        <Wallet className="h-3.5 w-3.5" />
                        Open Full Billing &amp; Wallets Console
                      </Link>
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-3 text-xs">
                <div className="rounded-md border border-border p-3">
                  <div className="text-muted-foreground">Active Project Capacity</div>
                  <div className="mt-1 text-base font-semibold">
                    {activeEntitlements?.activeProjectsCount ??
                      subscription?.usageThisCycle.projectsCount ??
                      0}{' '}
                    /{' '}
                    {activeEntitlements?.subscribedProjectCapacity ??
                      subscription?.entitlements.maxProjects ??
                      1}
                  </div>
                </div>
                <div className="rounded-md border border-border p-3">
                  <div className="text-muted-foreground">Prepaid AI Wallet Balance</div>
                  <div className="mt-1 text-base font-semibold text-primary">
                    {formatInr((activeEntitlements?.aiBalancePaise ?? 0) / 100)}
                  </div>
                </div>
                <div className="rounded-md border border-border p-3">
                  <div className="text-muted-foreground">Prepaid WhatsApp Wallet Balance</div>
                  <div className="mt-1 text-base font-semibold text-primary">
                    {formatInr((activeEntitlements?.whatsappBalancePaise ?? 0) / 100)}
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-4 md:grid-cols-2">
              {Object.values(DEFAULT_SAAS_PLANS).map((plan) => (
                <Card key={plan.code}>
                  <CardHeader>
                    <CardTitle className="text-sm">{plan.name}</CardTitle>
                    <div className="text-xl font-bold text-foreground">
                      {plan.code === 'SINGLE_PROJECT'
                        ? `${formatInr(plan.monthlyPriceInr)} / month + GST`
                        : `${formatInr(plan.perProjectMonthlyInr)} / project / month + GST (min 2)`}
                    </div>
                    <CardDescription>{plan.tagline}</CardDescription>
                  </CardHeader>
                  <CardContent className="text-xs text-muted-foreground space-y-1.5">
                    <div>
                      Project Slots:{' '}
                      {plan.code === 'SINGLE_PROJECT'
                        ? '1 Active Project (Hard Limit)'
                        : 'Minimum 2 Active Projects (INR 9,998/mo)'}
                    </div>
                    <div>AI &amp; WhatsApp Usage: Prepaid Wallets (Append-only Ledger)</div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="security">
          <Card>
            <CardHeader>
              <CardTitle>Multi-Factor Authentication (MFA)</CardTitle>
              <CardDescription>
                Privileged accounts (Super Admin, Builder Admin, Finance Manager) require a second
                factor. Enrolled factors: {mfaEnrolledCount}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 max-w-xl">
              {mfaStatusMsg && (
                <div className="rounded-md border border-border bg-secondary px-3 py-2 text-xs">
                  {mfaStatusMsg}
                </div>
              )}

              {!totpSecretUri ? (
                <Button size="sm" onClick={startTotpEnrollment}>
                  <ShieldCheck className="h-4 w-4" />
                  Enroll Authenticator App (TOTP)
                </Button>
              ) : (
                <form onSubmit={finalizeTotpEnrollment} className="space-y-3">
                  <div className="rounded-md border border-border bg-secondary p-3 text-xs font-mono break-all">
                    {totpSecretUri}
                  </div>
                  <div className="space-y-1">
                    <Label>Enter 6-digit code from Authenticator App</Label>
                    <Input
                      required
                      maxLength={6}
                      value={totpVerifyCode}
                      onChange={(e) => setTotpVerifyCode(e.target.value)}
                      placeholder="123456"
                    />
                  </div>
                  <Button type="submit" size="sm">
                    Verify & Activate MFA
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

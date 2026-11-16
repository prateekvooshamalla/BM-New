import * as React from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import {
  Building2,
  CalendarClock,
  CheckCircle2,
  Compass,
  Heart,
  MapPin,
  Scale,
  Search,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import {
  BRAND_CONFIG,
  DEFAULT_SAAS_PLANS,
  OPTIONAL_ONBOARDING_SERVICES,
  WALLET_TOPUP_PRESETS_INR,
  calculateBuilderSubscriptionMonthlyInr,
} from '@bharat-makaan/config';
import {
  formatAreaSqft,
  formatInr,
  formatInrCompact,
  type Project,
  type Unit,
} from '@bharat-makaan/shared';
import { callBackendFunction, db } from '@/lib/firebase';
import { useTenantStore } from '@/state/useTenantStore';
import { SeoHead } from '@/components/shared/SeoHead';
import { EmptyState } from '@/components/shared/EmptyState';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// Hook querying strictly `isPublicPublished == true` projects & units (zero dummy data)
function usePublishedCatalog() {
  const [projects, setProjects] = React.useState<Project[]>([]);
  const [units, setUnits] = React.useState<Unit[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [pSnap, uSnap] = await Promise.all([
          getDocs(query(collection(db, 'projects'), where('isPublicPublished', '==', true))),
          getDocs(query(collection(db, 'units'), where('isPublicPublished', '==', true))),
        ]);
        if (!active) return;
        setProjects(pSnap.docs.map((d) => d.data() as Project));
        setUnits(uSnap.docs.map((d) => d.data() as Unit));
      } catch {
        if (!active) return;
        setProjects([]);
        setUnits([]);
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, []);

  return { projects, units, loading };
}

// 1. HOMEPAGE
export function PublicHomePage() {
  const navigate = useNavigate();
  const { projects, units } = usePublishedCatalog();
  const { compareUnitIds, toggleCompareUnit } = useTenantStore();

  const [intent, setIntent] = React.useState<'BUY' | 'RENT'>('BUY');
  const [city, setCity] = React.useState('');
  const [location, setLocation] = React.useState('');
  const [propType, setPropType] = React.useState('ALL');
  const [budgetCr, setBudgetCr] = React.useState('');
  const [bhk, setBhk] = React.useState('');

  const handleHeroSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (city) params.set('city', city);
    if (location) params.set('location', location);
    if (propType !== 'ALL') params.set('type', propType);
    if (budgetCr) params.set('budgetCr', budgetCr);
    if (bhk) params.set('bhk', bhk);
    navigate(`/${intent.toLowerCase()}?${params.toString()}`);
  };

  return (
    <div>
      <SeoHead
        title="Find Your Next Property. Manage Real Estate with AI."
        description={BRAND_CONFIG.heroSubheadline}
        canonicalPath="/"
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'RealEstateAgent',
          name: BRAND_CONFIG.name,
          description: BRAND_CONFIG.positioning,
        }}
      />

      {/* Clean Architectural Hero */}
      <section className="border-b border-border bg-card py-16 sm:py-24">
        <div className="bm-container space-y-8">
          <div className="max-w-3xl space-y-4">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary px-3 py-1 text-xs font-medium text-primary">
              <Sparkles className="h-3.5 w-3.5" />
              {BRAND_CONFIG.positioning}
            </span>
            <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-5xl leading-tight">
              {BRAND_CONFIG.heroHeadline}
            </h1>
            <p className="text-base text-muted-foreground sm:text-lg leading-relaxed">
              {BRAND_CONFIG.heroSubheadline}
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Button size="lg" onClick={() => navigate('/buy')}>
                Explore Properties
              </Button>
              <Button variant="outline" size="lg" onClick={() => navigate('/app/dashboard')}>
                Manage with AI
              </Button>
            </div>
          </div>

          {/* Hero Search Bar: Buy/Rent, City, Location, Property type, Budget, BHK, Search */}
          <form
            onSubmit={handleHeroSearch}
            className="rounded-xl border border-border bg-background p-4 shadow-2xs"
          >
            <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-7">
              <Select value={intent} onValueChange={(v: any) => setIntent(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="BUY">Buy</SelectItem>
                  <SelectItem value="RENT">Rent</SelectItem>
                </SelectContent>
              </Select>

              <Input placeholder="City (e.g. Bengaluru)" value={city} onChange={(e) => setCity(e.target.value)} />
              <Input placeholder="Locality" value={location} onChange={(e) => setLocation(e.target.value)} />

              <Select value={propType} onValueChange={setPropType}>
                <SelectTrigger><SelectValue placeholder="Property Type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Types</SelectItem>
                  <SelectItem value="APARTMENT">Apartment</SelectItem>
                  <SelectItem value="VILLA">Villa</SelectItem>
                  <SelectItem value="PLOTTED">Plot</SelectItem>
                  <SelectItem value="COMMERCIAL">Commercial</SelectItem>
                </SelectContent>
              </Select>

              <Input type="number" step="0.1" placeholder="Max Budget (Cr)" value={budgetCr} onChange={(e) => setBudgetCr(e.target.value)} />
              <Input placeholder="BHK (e.g. 3 BHK)" value={bhk} onChange={(e) => setBhk(e.target.value)} />

              <Button type="submit" className="w-full">
                <Search className="h-4 w-4" />
                Search
              </Button>
            </div>
          </form>
        </div>
      </section>

      {/* Verified Published Projects Section */}
      <section className="py-14">
        <div className="bm-container space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold">Verified Builder Projects</h2>
              <p className="text-xs text-muted-foreground">
                Showing strictly RERA-registered projects published by verified builders.
              </p>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link to="/projects">View All Projects</Link>
            </Button>
          </div>

          {projects.length === 0 ? (
            <EmptyState
              icon={Building2}
              title="No published public listings yet."
              description="Only builder-approved public listings appear here. Builders can publish verified projects from the Enterprise Console."
              actionLabel="Open Builder Console"
              onAction={() => navigate('/app/dashboard')}
            />
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {projects.slice(0, 6).map((p) => (
                <Card key={p.id} className="flex flex-col justify-between">
                  <CardHeader>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{p.builderName}</span>
                      <StatusBadge status={p.constructionStatus} />
                    </div>
                    <CardTitle className="mt-1">{p.name}</CardTitle>
                    <CardDescription className="flex items-center gap-1">
                      <MapPin className="h-3.5 w-3.5" /> {p.locality}, {p.city}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 text-xs">
                    <div>Configurations: <strong>{p.configurations.join(', ')}</strong></div>
                    <div>RERA: <span className="font-mono">{p.reraNumber}</span></div>
                    {p.startingPriceInr && (
                      <div className="text-sm font-bold text-primary">
                        Starting from {formatInrCompact(p.startingPriceInr)}
                      </div>
                    )}
                    <div className="flex gap-2 pt-2">
                      <Button size="sm" className="flex-1" asChild>
                        <Link to={`/projects/${p.id}`}>Explore Project</Link>
                      </Button>
                      <Button variant="outline" size="sm" asChild>
                        <Link to={`/book-visit?orgId=${p.orgId}&projectId=${p.id}`}>Book Visit</Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {units.length > 0 && (
            <div className="pt-8 space-y-4">
              <h2 className="text-xl font-bold">Published Units Ready for Comparison</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {units.slice(0, 8).map((u) => (
                  <Card key={u.id}>
                    <CardContent className="p-4 space-y-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-sm">{u.unitNumber} ({u.bhk})</span>
                        <StatusBadge status={u.status} />
                      </div>
                      <div>{formatAreaSqft(u.saleableAreaSqft)} • {u.facing}</div>
                      <div className="text-base font-bold text-primary">
                        {formatInr(u.calculatedTotalPrice)}
                      </div>
                      <div className="flex gap-1.5 pt-2">
                        <Button size="sm" variant="outline" className="flex-1" asChild>
                          <Link to={`/properties/${u.id}`}>View</Link>
                        </Button>
                        <Button
                          size="sm"
                          variant={compareUnitIds.includes(u.id) ? 'default' : 'secondary'}
                          onClick={() => toggleCompareUnit(u.id)}
                        >
                          <Scale className="h-3 w-3" />
                          {compareUnitIds.includes(u.id) ? 'Added' : 'Compare'}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

// 2 & 3. BUY & RENT LISTINGS CATALOG
export function PublicListingsCatalogPage({ mode }: { mode: 'BUY' | 'RENT' }) {
  const [searchParams] = useSearchParams();
  const { projects, units, loading } = usePublishedCatalog();
  const { compareUnitIds, toggleCompareUnit } = useTenantStore();

  const [bhkFilter, setBhkFilter] = React.useState(searchParams.get('bhk') || '');
  const [cityFilter, setCityFilter] = React.useState(searchParams.get('city') || '');

  const projectMap = React.useMemo(
    () => new Map(projects.map((p) => [p.id, p])),
    [projects]
  );

  const filtered = units.filter((u) => {
    if (u.listingMode !== mode) return false;
    if (bhkFilter && !u.bhk.toLowerCase().includes(bhkFilter.toLowerCase())) return false;
    if (cityFilter) {
      const p = projectMap.get(u.projectId);
      if (p && !p.city.toLowerCase().includes(cityFilter.toLowerCase())) return false;
    }
    return true;
  });

  return (
    <div className="bm-container py-10 space-y-6">
      <SeoHead
        title={`${mode === 'BUY' ? 'Buy Verified Properties' : 'Rent Verified Properties'}`}
        description={`Browse approved ${mode.toLowerCase()} properties directly from verified builders on Bharat Makaan.`}
        canonicalPath={`/${mode.toLowerCase()}`}
      />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">
            {mode === 'BUY' ? 'Properties for Sale' : 'Properties for Rent'}
          </h1>
          <p className="text-xs text-muted-foreground">
            Real-time availability from approved builder inventory.
          </p>
        </div>
        <div className="flex gap-2">
          <Input placeholder="Filter by City" className="w-44" value={cityFilter} onChange={(e) => setCityFilter(e.target.value)} />
          <Input placeholder="Filter by BHK" className="w-36" value={bhkFilter} onChange={(e) => setBhkFilter(e.target.value)} />
        </div>
      </div>

      {!loading && filtered.length === 0 ? (
        <EmptyState
          icon={Building2}
          title={`No approved ${mode.toLowerCase()} properties match your search.`}
          description="Only verified builder inventory marked for public publication is displayed."
        />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((u) => {
            const proj = projectMap.get(u.projectId);
            return (
              <Card key={u.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {proj ? `${proj.name} • ${proj.city}` : 'Verified Listing'}
                    </span>
                    <StatusBadge status={u.status} />
                  </div>
                  <CardTitle className="text-base">
                    Unit {u.unitNumber} — {u.bhk} ({u.unitType})
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2.5 text-xs">
                  <div>
                    Saleable: <strong>{formatAreaSqft(u.saleableAreaSqft)}</strong> • Carpet:{' '}
                    <strong>{formatAreaSqft(u.carpetAreaSqft)}</strong>
                  </div>
                  <div>
                    <Compass className="inline h-3.5 w-3.5 mr-1" /> {u.facing} Facing •{' '}
                    {u.parkingEntitlementCount} Parking Space(s)
                  </div>
                  <div className="text-lg font-bold text-primary">
                    {mode === 'RENT' && u.monthlyRentInr
                      ? `${formatInr(u.monthlyRentInr)} / month`
                      : formatInr(u.calculatedTotalPrice)}
                  </div>
                  <div className="flex gap-2 pt-2">
                    <Button size="sm" className="flex-1" asChild>
                      <Link to={`/properties/${u.id}`}>Property Details</Link>
                    </Button>
                    <Button
                      size="sm"
                      variant={compareUnitIds.includes(u.id) ? 'default' : 'outline'}
                      onClick={() => toggleCompareUnit(u.id)}
                    >
                      <Scale className="h-3.5 w-3.5" />
                      {compareUnitIds.includes(u.id) ? 'Selected' : 'Compare'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// 4. PROJECTS DIRECTORY
export function PublicProjectsDirectoryPage() {
  const { projects, loading } = usePublishedCatalog();
  return (
    <div className="bm-container py-10 space-y-6">
      <SeoHead
        title="Verified Real Estate Projects"
        description="Explore RERA-registered residential, villa, plotted, and commercial projects."
        canonicalPath="/projects"
      />
      <h1 className="text-2xl font-bold">Verified RERA Projects ({projects.length})</h1>
      {!loading && projects.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No published projects available yet."
          description="Projects appear here as soon as builders enable Public Portal visibility."
        />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <Card key={p.id}>
              <CardHeader>
                <CardTitle>{p.name}</CardTitle>
                <CardDescription>
                  {p.builderName} • {p.locality}, {p.city}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                <div>RERA: {p.reraNumber}</div>
                <div>Configurations: {p.configurations.join(', ')}</div>
                <div className="flex gap-2 pt-2">
                  <Button size="sm" asChild>
                    <Link to={`/projects/${p.id}`}>View Project</Link>
                  </Button>
                  <Button variant="outline" size="sm" asChild>
                    <Link to={`/contact-builder/${p.orgId}?projectId=${p.id}`}>Contact Builder</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// 5. PROJECT DETAILS
export function PublicProjectDetailsPage() {
  const { projectId, slug } = useParams<{ projectId?: string; slug?: string }>();
  const lookupKey = projectId || slug || '';
  const [project, setProject] = React.useState<Project | null>(null);
  const [units, setUnits] = React.useState<Unit[]>([]);

  React.useEffect(() => {
    if (!lookupKey) return;
    let active = true;
    const load = async () => {
      let resolvedProject: Project | null = null;
      const directSnap = await getDoc(doc(db, 'projects', lookupKey));
      if (directSnap.exists() && directSnap.data()?.isPublicPublished) {
        resolvedProject = directSnap.data() as Project;
      } else {
        const slugSnap = await getDocs(
          query(
            collection(db, 'projects'),
            where('slug', '==', lookupKey),
            where('isPublicPublished', '==', true)
          )
        );
        if (!slugSnap.empty) {
          resolvedProject = slugSnap.docs[0]!.data() as Project;
        }
      }

      if (!active) return;
      setProject(resolvedProject);
      if (resolvedProject) {
        const unitsSnap = await getDocs(
          query(
            collection(db, 'units'),
            where('projectId', '==', resolvedProject.id),
            where('isPublicPublished', '==', true)
          )
        );
        if (active) setUnits(unitsSnap.docs.map((d) => d.data() as Unit));
      } else {
        setUnits([]);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [lookupKey]);

  if (!project) {
    return (
      <div className="bm-container py-14">
        <EmptyState
          icon={Building2}
          title="Project not found or not publicly published."
        />
      </div>
    );
  }

  return (
    <div className="bm-container py-10 space-y-6">
      <SeoHead
        title={`${project.name} by ${project.builderName} in ${project.city}`}
        description={`${project.configurations.join(', ')} at ${project.locality}, ${project.city}. RERA: ${project.reraNumber}`}
        canonicalPath={`/project/${project.slug || project.id}`}
      />
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold text-primary">{project.builderName}</p>
              <CardTitle className="text-2xl">{project.name}</CardTitle>
              <CardDescription>{project.address}</CardDescription>
            </div>
            <div className="flex gap-2">
              <Button size="sm" asChild>
                <Link to={`/book-visit?orgId=${project.orgId}&projectId=${project.id}`}>
                  <CalendarClock className="h-4 w-4" /> Book Site Visit
                </Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link to={`/contact-builder/${project.orgId}?projectId=${project.id}`}>
                  Enquire Now
                </Link>
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-4 text-xs">
          <div className="rounded border border-border p-3">
            <div className="text-muted-foreground">RERA Registration</div>
            <div className="font-mono font-semibold mt-1">{project.reraNumber}</div>
          </div>
          <div className="rounded border border-border p-3">
            <div className="text-muted-foreground">Configurations</div>
            <div className="font-semibold mt-1">{project.configurations.join(', ')}</div>
          </div>
          <div className="rounded border border-border p-3">
            <div className="text-muted-foreground">Construction Status</div>
            <div className="font-semibold mt-1">{project.constructionStatus.replace(/_/g, ' ')}</div>
          </div>
          <div className="rounded border border-border p-3">
            <div className="text-muted-foreground">Amenities</div>
            <div className="font-semibold mt-1">{project.amenities.join(', ') || 'Standard'}</div>
          </div>
        </CardContent>
      </Card>

      <h2 className="text-lg font-bold">Published Units in {project.name} ({units.length})</h2>
      <div className="grid gap-4 sm:grid-cols-3">
        {units.map((u) => (
          <Card key={u.id}>
            <CardContent className="p-4 space-y-2 text-xs">
              <div className="font-bold text-sm">{u.unitNumber} — {u.bhk}</div>
              <div>{formatAreaSqft(u.saleableAreaSqft)} • {u.facing} Facing</div>
              <div className="font-bold text-primary text-base">{formatInr(u.calculatedTotalPrice)}</div>
              <Button size="sm" variant="outline" asChild className="w-full">
                <Link to={`/property/${u.id}`}>Inspect Unit</Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// 6. PROPERTY DETAILS
export function PublicPropertyDetailsPage() {
  const navigate = useNavigate();
  const { unitId, slug } = useParams<{ unitId?: string; slug?: string }>();
  const lookupKey = unitId || slug || '';
  const { uid } = useTenantStore();
  const [unit, setUnit] = React.useState<Unit | null>(null);
  const [project, setProject] = React.useState<Project | null>(null);
  const [savedStatus, setSavedStatus] = React.useState<'IDLE' | 'SAVED' | 'REMOVED'>('IDLE');
  const [savingBusy, setSavingBusy] = React.useState(false);

  React.useEffect(() => {
    if (!lookupKey) return;
    getDoc(doc(db, 'units', lookupKey)).then(async (s) => {
      if (s.exists() && s.data()?.isPublicPublished) {
        const u = s.data() as Unit;
        setUnit(u);
        const pSnap = await getDoc(doc(db, 'projects', u.projectId));
        if (pSnap.exists()) setProject(pSnap.data() as Project);
      }
    });
  }, [lookupKey]);

  const handleToggleSave = async () => {
    if (!unit) return;
    if (!uid) {
      navigate(`/login?redirect=${encodeURIComponent(`/property/${unit.id}`)}`);
      return;
    }
    setSavingBusy(true);
    try {
      const res = await callBackendFunction<
        { unitId: string; projectId: string; orgId: string },
        { saved: boolean }
      >('toggleCustomerSavedProperty', {
        unitId: unit.id,
        projectId: unit.projectId,
        orgId: unit.orgId,
      });
      setSavedStatus(res.saved ? 'SAVED' : 'REMOVED');
    } finally {
      setSavingBusy(false);
    }
  };

  if (!unit) {
    return (
      <div className="bm-container py-14">
        <EmptyState icon={Building2} title="Property listing not found or unpublished." />
      </div>
    );
  }

  return (
    <div className="bm-container py-10 space-y-6">
      <SeoHead
        title={`Unit ${unit.unitNumber} (${unit.bhk}) — ${project?.name ?? 'Property'}`}
        description={`${formatAreaSqft(unit.saleableAreaSqft)} ${unit.facing} facing ${unit.bhk}.`}
        canonicalPath={`/property/${unit.id}`}
      />
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-2xl">
                Unit {unit.unitNumber} — {unit.bhk} ({unit.unitType})
              </CardTitle>
              <CardDescription>
                {project ? `${project.name} by ${project.builderName} (${project.locality}, ${project.city})` : ''}
              </CardDescription>
            </div>
            <StatusBadge status={unit.status} />
          </div>
        </CardHeader>
        <CardContent className="space-y-5 text-xs">
          <div className="grid gap-4 sm:grid-cols-4">
            <div className="rounded border border-border p-3">
              <span className="text-muted-foreground">Saleable / Carpet Area</span>
              <div className="font-semibold mt-1">
                {formatAreaSqft(unit.saleableAreaSqft)} / {formatAreaSqft(unit.carpetAreaSqft)}
              </div>
            </div>
            <div className="rounded border border-border p-3">
              <span className="text-muted-foreground">Floor & Facing</span>
              <div className="font-semibold mt-1">
                Floor {unit.floorNumber} • {unit.facing}
              </div>
            </div>
            <div className="rounded border border-border p-3">
              <span className="text-muted-foreground">Parking Entitlement</span>
              <div className="font-semibold mt-1">{unit.parkingEntitlementCount} Space(s)</div>
            </div>
            <div className="rounded border border-border p-3">
              <span className="text-muted-foreground">Estimated Purchase Cost</span>
              <div className="font-bold text-primary text-base mt-1">
                {formatInr(unit.calculatedTotalPrice)}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button asChild>
              <Link to={`/book-visit?orgId=${unit.orgId}&projectId=${unit.projectId}&unitId=${unit.id}`}>
                Schedule Site Visit
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to={`/contact-builder/${unit.orgId}?projectId=${unit.projectId}&unitId=${unit.id}`}>
                Request Official Cost Sheet
              </Link>
            </Button>
            <Button
              type="button"
              variant={savedStatus === 'SAVED' ? 'secondary' : 'outline'}
              disabled={savingBusy}
              onClick={handleToggleSave}
            >
              <Heart className="h-4 w-4" />
              {savedStatus === 'SAVED'
                ? 'Saved to My Properties'
                : savedStatus === 'REMOVED'
                  ? 'Save Property'
                  : 'Save Property'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// 7. PROPERTY COMPARISON MATRIX (Real Published Data Only)
export function PublicPropertyComparePage() {
  const { projects, units } = usePublishedCatalog();
  const { compareUnitIds, clearCompareUnits } = useTenantStore();

  const comparedUnits = units.filter((u) => compareUnitIds.includes(u.id));
  const projMap = new Map(projects.map((p) => [p.id, p]));

  return (
    <div className="bm-container py-10 space-y-6">
      <SeoHead
        title="Compare Properties Side by Side"
        description="Compare price, area, builder, RERA, facing, parking, possession, floor plans, and total estimated purchase cost."
        canonicalPath="/compare"
      />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Property Comparison</h1>
          <p className="text-xs text-muted-foreground">
            Compare up to 4 real published properties across 11 enterprise parameters.
          </p>
        </div>
        {comparedUnits.length > 0 && (
          <Button variant="outline" size="sm" onClick={clearCompareUnits}>
            Clear Selection
          </Button>
        )}
      </div>

      {comparedUnits.length === 0 ? (
        <EmptyState
          icon={Scale}
          title="No properties selected for comparison."
          description="Click 'Compare' on any published property card under Buy or Rent to compare real specifications side by side."
        />
      ) : (
        <div className="bm-table-wrapper overflow-x-auto">
          <table className="bm-table w-full text-xs">
            <thead>
              <tr>
                <th>Attribute</th>
                {comparedUnits.map((u) => (
                  <th key={u.id}>
                    Unit {u.unitNumber} ({u.bhk})
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="font-semibold">Base Rate / Price</td>
                {comparedUnits.map((u) => (
                  <td key={u.id}>{formatInr(u.baseRatePerSqft)} / sq.ft.</td>
                ))}
              </tr>
              <tr>
                <td className="font-semibold">Saleable / Carpet Area</td>
                {comparedUnits.map((u) => (
                  <td key={u.id}>
                    {formatAreaSqft(u.saleableAreaSqft)} / {formatAreaSqft(u.carpetAreaSqft)}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="font-semibold">Location</td>
                {comparedUnits.map((u) => {
                  const p = projMap.get(u.projectId);
                  return <td key={u.id}>{p ? `${p.locality}, ${p.city}` : '—'}</td>;
                })}
              </tr>
              <tr>
                <td className="font-semibold">Builder</td>
                {comparedUnits.map((u) => (
                  <td key={u.id}>{projMap.get(u.projectId)?.builderName ?? '—'}</td>
                ))}
              </tr>
              <tr>
                <td className="font-semibold">BHK & Type</td>
                {comparedUnits.map((u) => (
                  <td key={u.id}>{u.bhk} ({u.unitType})</td>
                ))}
              </tr>
              <tr>
                <td className="font-semibold">Facing</td>
                {comparedUnits.map((u) => (
                  <td key={u.id}>{u.facing}</td>
                ))}
              </tr>
              <tr>
                <td className="font-semibold">Parking Entitlement</td>
                {comparedUnits.map((u) => (
                  <td key={u.id}>{u.parkingEntitlementCount} Space(s)</td>
                ))}
              </tr>
              <tr>
                <td className="font-semibold">Amenities</td>
                {comparedUnits.map((u) => (
                  <td key={u.id}>
                    {(projMap.get(u.projectId)?.amenities ?? []).slice(0, 4).join(', ') || '—'}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="font-semibold">Possession</td>
                {comparedUnits.map((u) => (
                  <td key={u.id}>{projMap.get(u.projectId)?.possessionDate ?? 'As per RERA'}</td>
                ))}
              </tr>
              <tr>
                <td className="font-semibold">Available Floor Plan</td>
                {comparedUnits.map((u) => (
                  <td key={u.id}>{u.floorPlanVersionId ? 'Approved Layout Linked' : 'Pending Upload'}</td>
                ))}
              </tr>
              <tr>
                <td className="font-bold text-primary">Total Estimated Purchase Cost</td>
                {comparedUnits.map((u) => (
                  <td key={u.id} className="font-bold text-primary text-sm">
                    {formatInr(u.calculatedTotalPrice)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// 8. BOOK SITE VISIT PAGE
export function PublicBookVisitPage() {
  const [searchParams] = useSearchParams();
  const { projects } = usePublishedCatalog();
  const [selectedProjId, setSelectedProjId] = React.useState(searchParams.get('projectId') || '');
  const [name, setName] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [startAt, setStartAt] = React.useState('');
  const [done, setDone] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const proj = projects.find((p) => p.id === selectedProjId);
    const orgId = proj?.orgId || searchParams.get('orgId') || '';
    if (!orgId || !selectedProjId) {
      setErr('Please select a published project.');
      return;
    }
    try {
      const sDate = new Date(startAt);
      const eDate = new Date(sDate.getTime() + 60 * 60 * 1000);
      await callBackendFunction('submitPublicSiteVisit', {
        orgId,
        projectId: selectedProjId,
        unitId: searchParams.get('unitId') || undefined,
        customerName: name,
        customerPhone: phone,
        customerEmail: email,
        scheduledStartAt: sDate.toISOString(),
        scheduledEndAt: eDate.toISOString(),
      });
      setDone(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Unable to schedule visit.');
    }
  };

  return (
    <div className="bm-container py-12 max-w-xl">
      <SeoHead
        title="Book a Site Visit"
        description="Schedule an in-person experience center or model apartment visit."
        canonicalPath="/book-visit"
      />
      <Card>
        <CardHeader>
          <CardTitle>Schedule a Verified Site Visit</CardTitle>
          <CardDescription>
            Your visit request routes directly to the builder’s on-site relationship team.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {done ? (
            <div className="py-6 text-center space-y-2">
              <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
              <div className="font-semibold text-sm">Site Visit Confirmed!</div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              {err && <div className="text-xs text-destructive">{err}</div>}
              <div className="space-y-1">
                <Label>Select Project *</Label>
                <Select value={selectedProjId} onValueChange={setSelectedProjId}>
                  <SelectTrigger><SelectValue placeholder="Choose published project" /></SelectTrigger>
                  <SelectContent>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name} ({p.city})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Your Name *</Label>
                <Input required value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Mobile Number *</Label>
                <Input required value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Email</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Preferred Date & Time *</Label>
                <Input type="datetime-local" required value={startAt} onChange={(e) => setStartAt(e.target.value)} />
              </div>
              <Button type="submit" className="w-full">Confirm Site Visit</Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// 9. CONTACT BUILDER PAGE
export function PublicContactBuilderPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const [searchParams] = useSearchParams();
  const [name, setName] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [msg, setMsg] = React.useState('');
  const [done, setDone] = React.useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId) return;
    await callBackendFunction('submitPublicPortalEnquiry', {
      orgId,
      projectId: searchParams.get('projectId') || undefined,
      unitId: searchParams.get('unitId') || undefined,
      customerName: name,
      phone,
      email,
      message: msg,
    });
    setDone(true);
  };

  return (
    <div className="bm-container py-12 max-w-xl">
      <SeoHead
        title="Contact Builder Sales Team"
        description="Send an enquiry directly into the builder's verified Bharat Makaan CRM."
        canonicalPath={`/contact-builder/${orgId ?? ''}`}
      />
      <Card>
        <CardHeader>
          <CardTitle>Enquire Directly with Builder</CardTitle>
        </CardHeader>
        <CardContent>
          {done ? (
            <div className="py-6 text-center text-sm font-semibold text-emerald-700">
              Enquiry delivered to builder CRM!
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              <Input required placeholder="Your Full Name *" value={name} onChange={(e) => setName(e.target.value)} />
              <Input required placeholder="Mobile Number *" value={phone} onChange={(e) => setPhone(e.target.value)} />
              <Input type="email" placeholder="Email Address" value={email} onChange={(e) => setEmail(e.target.value)} />
              <Textarea placeholder="Questions regarding floor plans, pricing or availability..." value={msg} onChange={(e) => setMsg(e.target.value)} />
              <Button type="submit" className="w-full">Send Enquiry</Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// 10. FOR PROFESSIONALS
export function PublicForProfessionalsPage() {
  return (
    <div className="bm-container py-14 space-y-10">
      <SeoHead
        title="For Builders, Developers & Channel Partners"
        description={BRAND_CONFIG.promise}
        canonicalPath="/for-professionals"
      />
      <div className="max-w-3xl space-y-3">
        <h1 className="text-3xl font-bold">{BRAND_CONFIG.positioning}</h1>
        <p className="text-muted-foreground">{BRAND_CONFIG.promise}</p>
        <div className="flex gap-3 pt-2">
          <Button asChild><Link to="/auth/register">Onboard Builder Organization</Link></Button>
          <Button variant="outline" asChild><Link to="/pricing">View SaaS Plans</Link></Button>
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-3">
        {[
          {
            title: 'Visual Inventory & Physical Parking',
            desc: 'Interactive tower/floor matrices, plotted & villa support, transactional unit holds, and conflict-free basement/podium parking allocations.',
          },
          {
            title: 'Dynamic Pricing & Deterministic Cost Sheets',
            desc: 'Editable cost-sheet labels with stable keys, director approval locks, historical price charts, CLP schedules, and authoritative PDF quotations.',
          },
          {
            title: 'Omnichannel CRM, WhatsApp & Channel Partners',
            desc: 'Meta WhatsApp Cloud API shared inbox, RERA partner lead-protection rules, visual form builder, and OpenAI sales intelligence.',
          },
        ].map((item) => (
          <Card key={item.title}>
            <CardHeader>
              <ShieldCheck className="h-5 w-5 text-primary mb-1" />
              <CardTitle className="text-base">{item.title}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground leading-relaxed">
              {item.desc}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// 11. SAAS PRICING PAGE
export function PublicPricingPage() {
  const [multiProjectSlots, setMultiProjectSlots] = React.useState(2);
  const multiCalc = calculateBuilderSubscriptionMonthlyInr('MULTI_PROJECT', multiProjectSlots, 18);

  return (
    <div className="bm-container py-14 space-y-10">
      <SeoHead
        title="Enterprise Real Estate SaaS Pricing"
        description="Single Project (INR 5,999/mo) and Multi-Project (INR 4,999/project/mo, min 2 projects) packages for builders."
        canonicalPath="/pricing"
      />
      <div className="max-w-3xl space-y-2">
        <h1 className="text-3xl font-bold">Simple, Transparent Builder Packages</h1>
        <p className="text-sm text-muted-foreground">
          Strictly two paid monthly builder packages. Optional assisted onboarding is one-time and
          never required, and AI + WhatsApp run on transparent prepaid usage wallets.
        </p>
      </div>

      {/* Strictly Two Paid Builder Packages */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card className="flex flex-col justify-between">
          <CardHeader>
            <CardTitle>{DEFAULT_SAAS_PLANS.SINGLE_PROJECT.name}</CardTitle>
            <div className="mt-2 text-3xl font-bold text-primary">
              {formatInr(DEFAULT_SAAS_PLANS.SINGLE_PROJECT.monthlyPriceInr)}
              <span className="text-sm font-normal text-muted-foreground"> / month + GST</span>
            </div>
            <CardDescription>{DEFAULT_SAAS_PLANS.SINGLE_PROJECT.tagline}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5 text-xs">
            <div>
              Active Project Capacity: <strong>1 Active Project (Hard Limit)</strong>
            </div>
            <div>
              Builder Staff &amp; Role Permissions: <strong>Included</strong>
            </div>
            <div>
              Inventory, Physical Parking, Cost Sheets &amp; Bookings: <strong>Included</strong>
            </div>
            <div>
              Channel Partner Portal &amp; Lead Protection: <strong>Included</strong>
            </div>
            <div className="pt-4">
              <Button className="w-full" size="sm" asChild>
                <Link to="/register?persona=builder">Start Single Project Package</Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="flex flex-col justify-between border-primary/50">
          <CardHeader>
            <CardTitle>{DEFAULT_SAAS_PLANS.MULTI_PROJECT.name}</CardTitle>
            <div className="mt-2 text-3xl font-bold text-primary">
              {formatInr(DEFAULT_SAAS_PLANS.MULTI_PROJECT.perProjectMonthlyInr)}
              <span className="text-sm font-normal text-muted-foreground">
                {' '}
                / project / month + GST
              </span>
            </div>
            <CardDescription>
              Minimum 2 active projects ({formatInr(9998)} / month before GST). Scale project slots
              anytime.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            <div className="rounded-lg border border-border bg-secondary/40 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="public-slots-calc" className="text-xs font-semibold">
                  Subscribed Project Slots (Min 2)
                </Label>
                <Input
                  id="public-slots-calc"
                  type="number"
                  min={2}
                  max={250}
                  className="h-8 w-24 text-right"
                  value={multiProjectSlots}
                  onChange={(e) => setMultiProjectSlots(Math.max(2, Number(e.target.value) || 2))}
                />
              </div>
              <div className="flex items-center justify-between text-sm font-bold text-foreground">
                <span>{multiCalc.subscribedProjectCapacity} Active Projects</span>
                <span>{formatInr(multiCalc.monthlySubtotalInr)} / month + GST</span>
              </div>
            </div>
            <div>
              Consolidated Organization Analytics &amp; Cross-Project Staff Allocation:{' '}
              <strong>Included</strong>
            </div>
            <div>
              Multi-Builder Channel Partner Authorizations: <strong>Included</strong>
            </div>
            <div className="pt-2">
              <Button className="w-full" size="sm" asChild>
                <Link to="/register?persona=builder">Start Multi-Project Package</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Optional One-Time Assisted Onboarding */}
      <div className="space-y-3">
        <h2 className="text-xl font-bold">Optional One-Time Assisted Onboarding</h2>
        <p className="text-xs text-muted-foreground">
          Self-service onboarding is always ₹0. Assisted setup is optional and billed once only if
          explicitly selected at checkout.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Object.values(OPTIONAL_ONBOARDING_SERVICES).map((svc) => (
            <Card key={svc.code}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">{svc.name}</CardTitle>
                <div className="text-lg font-bold text-primary">
                  {svc.oneTimeFeeInr === null
                    ? 'Custom Quote'
                    : svc.oneTimeFeeInr === 0
                      ? 'Free (₹0)'
                      : `${formatInr(svc.oneTimeFeeInr)} one-time`}
                </div>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">{svc.description}</CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Prepaid AI & WhatsApp Wallets */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Prepaid AI Wallet &amp; WhatsApp Cloud Wallet
          </CardTitle>
          <CardDescription>
            AI Assistant / Floor-Plan Extraction and Meta WhatsApp Cloud API messages are metered
            against transparent prepaid wallets — never bundled as hidden overages. Top up presets:{' '}
            {WALLET_TOPUP_PRESETS_INR.map((amt) => formatInr(amt)).join(', ')} or custom ≥ ₹100.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}

// 12 & 13. ABOUT & CONTACT PAGES
export function PublicAboutPage() {
  return (
    <div className="bm-container py-14 max-w-3xl space-y-4">
      <SeoHead
        title="About Bharat Makaan"
        description="Modern multi-tenant real estate operating system built for Indian builders, channel partners, and buyers."
        canonicalPath="/about"
      />
      <h1 className="text-3xl font-bold">About {BRAND_CONFIG.name}</h1>
      <p className="text-sm leading-relaxed text-muted-foreground">
        {BRAND_CONFIG.name} unifies verified buyer discovery with enterprise-grade multi-builder
        inventory, physical parking, deterministic pricing & cost sheets, RERA document compliance,
        channel partner lead protection, and AI-assisted sales operations on one secure cloud
        architecture.
      </p>
    </div>
  );
}

export function PublicContactPage() {
  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [company, setCompany] = React.useState('');
  const [subject, setSubject] = React.useState('');
  const [message, setMessage] = React.useState('');
  const [ticketId, setTicketId] = React.useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await callBackendFunction<any, { ticketId: string }>(
      'submitPlatformSupportRequest',
      {
        name,
        email,
        companyName: company,
        subject,
        message,
      }
    );
    setTicketId(res.ticketId);
  };

  return (
    <div className="bm-container py-14 max-w-xl">
      <SeoHead
        title="Contact Sales & Support"
        description="Reach the Bharat Makaan Enterprise onboarding and technical support team."
        canonicalPath="/contact"
      />
      <Card>
        <CardHeader>
          <CardTitle>Contact {BRAND_CONFIG.name}</CardTitle>
          <CardDescription>
            Enterprise onboarding, custom plans, integration assistance, and platform support.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {ticketId ? (
            <div className="py-6 text-center text-xs space-y-2">
              <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600" />
              <div className="font-semibold">Support Ticket Registered (#{ticketId})</div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              <Input required placeholder="Full Name *" value={name} onChange={(e) => setName(e.target.value)} />
              <Input type="email" required placeholder="Work Email *" value={email} onChange={(e) => setEmail(e.target.value)} />
              <Input placeholder="Builder / Agency Company Name" value={company} onChange={(e) => setCompany(e.target.value)} />
              <Input required placeholder="Subject *" value={subject} onChange={(e) => setSubject(e.target.value)} />
              <Textarea required placeholder="How can our team help?" value={message} onChange={(e) => setMessage(e.target.value)} />
              <Button type="submit" className="w-full">Submit Request</Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

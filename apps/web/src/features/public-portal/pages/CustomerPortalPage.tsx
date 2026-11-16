import * as React from 'react';
import { Link } from 'react-router-dom';
import { Bookmark, CalendarClock, MessageSquareText, Trash2 } from 'lucide-react';
import { formatAreaSqft, formatInr } from '@bharat-makaan/shared';
import { callBackendFunction } from '@/lib/firebase';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function CustomerPortalPage({
  section,
}: {
  section: 'saved' | 'enquiries' | 'visits';
}) {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [data, setData] = React.useState<{
    savedProperties: Array<Record<string, any>>;
    myEnquiries: Array<Record<string, any>>;
    myVisits: Array<Record<string, any>>;
  }>({
    savedProperties: [],
    myEnquiries: [],
    myVisits: [],
  });

  const loadPortal = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await callBackendFunction<Record<string, never>, any>(
        'getCustomerPortalData',
        {}
      );
      setData({
        savedProperties: res.savedProperties ?? [],
        myEnquiries: res.myEnquiries ?? [],
        myVisits: res.myVisits ?? [],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load customer records.');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadPortal();
  }, [loadPortal]);

  const handleRemoveSaved = async (unitId: string) => {
    try {
      await callBackendFunction('toggleCustomerSavedProperty', { unitId });
      await loadPortal();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update saved property.');
    }
  };

  return (
    <div className="bm-container py-10 space-y-6">
      <PageHeader
        eyebrow="Personal Buyer & Tenant Account"
        title={
          section === 'saved'
            ? 'Saved Properties'
            : section === 'enquiries'
              ? 'My Property Enquiries'
              : 'My Scheduled Site Visits'
        }
        description="Track your shortlisted RERA-verified listings, submitted enquiries, and upcoming project visits."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant={section === 'saved' ? 'default' : 'outline'}
              size="sm"
              asChild
            >
              <Link to="/saved">Saved ({data.savedProperties.length})</Link>
            </Button>
            <Button
              variant={section === 'enquiries' ? 'default' : 'outline'}
              size="sm"
              asChild
            >
              <Link to="/my-enquiries">My Enquiries ({data.myEnquiries.length})</Link>
            </Button>
            <Button
              variant={section === 'visits' ? 'default' : 'outline'}
              size="sm"
              asChild
            >
              <Link to="/my-visits">My Visits ({data.myVisits.length})</Link>
            </Button>
          </div>
        }
      />

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-xs text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center text-xs text-muted-foreground">
          Loading your personal property records...
        </div>
      ) : section === 'saved' ? (
        data.savedProperties.length === 0 ? (
          <EmptyState
            icon={Bookmark}
            title="No saved properties yet."
            description="Browse Buy or Rent listings and click 'Save Property' to shortlist homes here."
            actionLabel="Explore Properties"
            onAction={() => {
              window.location.href = '/buy';
            }}
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.savedProperties.map((u) => (
              <Card key={u.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">
                      Unit {u.unitNumber} — {u.bhk}
                    </CardTitle>
                    <StatusBadge status={u.status} />
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 text-xs">
                  <div className="text-muted-foreground">
                    {formatAreaSqft(u.saleableAreaSqft)} • {u.facing} Facing
                  </div>
                  <div className="text-base font-bold text-primary">
                    {u.listingMode === 'RENT' && u.monthlyRentInr
                      ? `${formatInr(u.monthlyRentInr)}/mo`
                      : formatInr(u.calculatedTotalPrice)}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="flex-1" asChild>
                      <Link to={`/property/${u.id}`}>View Listing</Link>
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRemoveSaved(u.id)}
                      aria-label="Remove saved property"
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )
      ) : section === 'enquiries' ? (
        data.myEnquiries.length === 0 ? (
          <EmptyState
            icon={MessageSquareText}
            title="No enquiries submitted yet."
            description="Submit an enquiry on any verified project or property listing to track responses here."
          />
        ) : (
          <div className="grid gap-3">
            {data.myEnquiries.map((enq) => (
              <Card key={enq.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 text-xs">
                  <div>
                    <div className="font-semibold text-sm text-foreground">
                      {enq.projectName || 'Property Enquiry'}
                    </div>
                    <div className="text-muted-foreground">
                      Submitted on {new Date(enq.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <StatusBadge status={enq.stage} />
                </CardContent>
              </Card>
            ))}
          </div>
        )
      ) : data.myVisits.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="No scheduled site visits yet."
          description="Book a site visit on any published project to view appointment confirmations here."
        />
      ) : (
        <div className="grid gap-3">
          {data.myVisits.map((v) => (
            <Card key={v.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 text-xs">
                <div>
                  <div className="font-semibold text-sm text-foreground">
                    {v.projectName || 'Project Site Visit'}
                  </div>
                  <div className="text-muted-foreground">
                    Scheduled: {new Date(v.scheduledStartAt).toLocaleString()}
                  </div>
                </div>
                <StatusBadge status={v.status} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

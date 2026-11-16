import { Badge } from '@/components/ui/badge';

const STATUS_STYLE_MAP: Record<
  string,
  'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'destructive'
> = {
  AVAILABLE: 'success',
  ACTIVE: 'success',
  APPROVED: 'success',
  VERIFIED: 'success',
  VERIFIED_ACTIVE: 'success',
  ISSUED: 'success',
  PAID: 'success',
  COMPLETED: 'success',
  CONFIRMED: 'success',
  PROTECTED: 'success',
  PUBLISHED: 'success',
  ON_HOLD: 'warning',
  PENDING: 'warning',
  PENDING_APPROVAL: 'warning',
  PENDING_VERIFICATION: 'warning',
  INVITED: 'warning',
  TRIAL: 'warning',
  DISPUTED: 'warning',
  SCHEDULED: 'default',
  RESERVED: 'default',
  BOOKED: 'default',
  AGREEMENT: 'default',
  AGREEMENT_EXECUTED: 'default',
  REGISTERED: 'secondary',
  DRAFT: 'secondary',
  ARCHIVED: 'secondary',
  NOT_CONFIGURED: 'secondary',
  SUSPENDED: 'destructive',
  REVOKED: 'destructive',
  CANCELLED: 'destructive',
  REJECTED: 'destructive',
  BOUNCED: 'destructive',
  LOST: 'destructive',
  ERROR: 'destructive',
};

export function StatusBadge({ status }: { status: string }) {
  const variant = STATUS_STYLE_MAP[status] ?? 'secondary';
  return <Badge variant={variant}>{status.replace(/_/g, ' ')}</Badge>;
}

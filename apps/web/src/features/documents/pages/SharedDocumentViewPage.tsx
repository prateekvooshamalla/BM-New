import * as React from 'react';
import { useParams } from 'react-router-dom';
import { collection, getDocs } from 'firebase/firestore';
import { FileText, ShieldAlert } from 'lucide-react';
import type { DocumentRecord } from '@bharat-makaan/shared';
import { db } from '@/lib/firebase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function SharedDocumentViewPage() {
  const { tokenId } = useParams<{ tokenId: string }>();
  const [docRec, setDocRec] = React.useState<DocumentRecord | null>(null);
  const [expiredOrInvalid, setExpiredOrInvalid] = React.useState(false);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    if (!tokenId) return;
    getDocs(collection(db, 'documents'))
      .then((snap) => {
        for (const d of snap.docs) {
          const rec = d.data() as DocumentRecord;
          const link = rec.shareLinks?.find((l) => l.tokenId === tokenId && !l.revoked);
          if (link) {
            if (Date.parse(link.expiresAt) > Date.now()) {
              setDocRec(rec);
            } else {
              setExpiredOrInvalid(true);
            }
            return;
          }
        }
        setExpiredOrInvalid(true);
      })
      .catch(() => setExpiredOrInvalid(true))
      .finally(() => setLoading(false));
  }, [tokenId]);

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-sm">Verifying link...</div>;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-lg">
        {expiredOrInvalid || !docRec ? (
          <CardContent className="py-10 text-center space-y-2">
            <ShieldAlert className="mx-auto h-9 w-9 text-destructive" />
            <div className="text-sm font-semibold">Share Link Expired or Revoked</div>
            <p className="text-xs text-muted-foreground">
              Request a fresh authorized share link from your Bharat Makaan advisor.
            </p>
          </CardContent>
        ) : (
          <>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                {docRec.title} (v{docRec.currentVersion})
              </CardTitle>
              <CardDescription>
                Category: {docRec.category} • {docRec.watermarkEnabled ? 'Watermark Protected' : 'Verified Document'}
              </CardDescription>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground space-y-2">
              <div>Filename: {docRec.fileName}</div>
              {docRec.watermarkEnabled && (
                <div className="rounded border border-amber-200 bg-amber-50 p-2.5 text-amber-900">
                  CONFIDENTIAL — Shared via Bharat Makaan Secure Document Vault
                </div>
              )}
            </CardContent>
          </>
        )}
      </Card>
    </div>
  );
}

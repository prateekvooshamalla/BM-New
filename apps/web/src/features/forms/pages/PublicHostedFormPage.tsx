import * as React from 'react';
import { useParams } from 'react-router-dom';
import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { CheckCircle2 } from 'lucide-react';
import type { LeadCaptureForm } from '@bharat-makaan/shared';
import { callBackendFunction, db } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export function PublicHostedFormPage() {
  const { formSlug } = useParams<{ formSlug: string }>();
  const [form, setForm] = React.useState<LeadCaptureForm | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [consent, setConsent] = React.useState(false);
  const [honeypot, setHoneypot] = React.useState('');
  const [submittedMsg, setSubmittedMsg] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!formSlug) return;
    const load = async () => {
      try {
        const snap = await getDocs(
          query(
            collection(db, 'forms'),
            where('slug', '==', formSlug.toLowerCase()),
            where('status', '==', 'PUBLISHED'),
            limit(1)
          )
        );
        if (!snap.empty) {
          setForm(snap.docs[0]!.data() as LeadCaptureForm);
        }
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [formSlug]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formSlug || !consent) {
      setError('Please accept the consent checkbox before submitting.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await callBackendFunction<any, { successMessage: string }>(
        'submitPublicLeadForm',
        {
          formSlug,
          values,
          consentAccepted: true,
          honeypotValue: honeypot,
        }
      );
      setSubmittedMsg(res.successMessage);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submission failed.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-sm">Loading form...</div>;
  }

  if (!form) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 text-sm text-muted-foreground">
        This lead capture form is not published or no longer active.
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>{form.branding.headline}</CardTitle>
          {form.branding.description && (
            <CardDescription>{form.branding.description}</CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {submittedMsg ? (
            <div className="flex flex-col items-center py-8 text-center space-y-3">
              <CheckCircle2 className="h-10 w-10 text-emerald-600" />
              <div className="text-sm font-semibold">{submittedMsg}</div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                  {error}
                </div>
              )}

              {/* Anti-bot honeypot field */}
              <input
                type="text"
                tabIndex={-1}
                autoComplete="off"
                className="hidden"
                value={honeypot}
                onChange={(e) => setHoneypot(e.target.value)}
              />

              {form.fields
                .sort((a, b) => a.order - b.order)
                .map((field) => {
                  if (field.condition) {
                    const depVal = values[field.condition.dependsOnFieldId] ?? '';
                    if (depVal !== field.condition.equalsValue) return null;
                  }

                  return (
                    <div key={field.id} className="space-y-1.5">
                      <Label>
                        {field.label} {field.required && '*'}
                      </Label>
                      {field.options && field.options.length > 0 ? (
                        <Select
                          value={values[field.id] ?? ''}
                          onValueChange={(v) => setValues((p) => ({ ...p, [field.id]: v }))}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select an option" />
                          </SelectTrigger>
                          <SelectContent>
                            {field.options.map((opt) => (
                              <SelectItem key={opt} value={opt}>
                                {opt}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          required={field.required}
                          type={
                            field.type === 'EMAIL'
                              ? 'email'
                              : field.type === 'NUMBER' || field.type === 'BUDGET'
                                ? 'number'
                                : field.type === 'DATE'
                                  ? 'date'
                                  : 'text'
                          }
                          placeholder={field.placeholder || field.label}
                          value={values[field.id] ?? ''}
                          onChange={(e) =>
                            setValues((p) => ({ ...p, [field.id]: e.target.value }))
                          }
                        />
                      )}
                    </div>
                  );
                })}

              <label className="flex items-start gap-2.5 text-xs text-muted-foreground cursor-pointer pt-1">
                <Checkbox
                  checked={consent}
                  onCheckedChange={(v) => setConsent(Boolean(v))}
                />
                <span>{form.consentText}</span>
              </label>

              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? 'Submitting...' : 'Submit Enquiry'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

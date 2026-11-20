import * as React from 'react';
import {
  Building2,
  CheckCircle2,
  Download,
  FileText,
  Mail,
  MessageSquare,
  Printer,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  formatInr,
  formatInrCompact,
  type Booking,
  type CollectionRecord,
  type Project,
} from '@bharat-makaan/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface ReceiptAndDemandModalsProps {
  receiptCollection: CollectionRecord | null;
  onCloseReceipt: () => void;
  demandCollection: CollectionRecord | null;
  onCloseDemand: () => void;
  bookingMap: Map<string, Booking>;
  projectMap: Map<string, Project>;
  orgName?: string;
}

export function ReceiptAndDemandModals({
  receiptCollection,
  onCloseReceipt,
  demandCollection,
  onCloseDemand,
  bookingMap,
  projectMap,
  orgName = 'Bharat Makaan Developer',
}: ReceiptAndDemandModalsProps) {
  // 1. Receipt Modal
  const receiptBooking = receiptCollection
    ? bookingMap.get(receiptCollection.bookingId)
    : null;
  const receiptProject = receiptCollection
    ? projectMap.get(receiptCollection.projectId)
    : null;

  // 2. Demand Modal
  const demandBooking = demandCollection
    ? bookingMap.get(demandCollection.bookingId)
    : null;
  const demandProject = demandCollection
    ? projectMap.get(demandCollection.projectId)
    : null;

  const handlePrint = () => {
    window.print();
  };

  const handleShareReceiptWhatsApp = () => {
    if (!receiptBooking || !receiptCollection) return;
    const phone = receiptBooking.customer.phone.replace(/[^0-9]/g, '');
    const msg = `Dear ${receiptBooking.customer.fullName}, here is your official payment receipt #${receiptCollection.receiptNumber || receiptCollection.id} for Unit ${receiptBooking.unitNumber}. Amount: ₹${receiptCollection.paidAmountInr.toLocaleString('en-IN')}. Thank you!`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  const handleShareDemandWhatsApp = () => {
    if (!demandBooking || !demandCollection) return;
    const phone = demandBooking.customer.phone.replace(/[^0-9]/g, '');
    const dueStr = demandCollection.dueDate ? new Date(demandCollection.dueDate).toLocaleDateString() : 'Immediate';
    const msg = `Dear ${demandBooking.customer.fullName}, payment demand notice for Unit ${demandBooking.unitNumber}. Milestone: ${demandCollection.milestoneName}. Amount: ₹${demandCollection.demandAmountInr.toLocaleString('en-IN')}. Due date: ${dueStr}. Please complete payment.`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  return (
    <>
      {/* Official Payment Receipt Modal */}
      <Dialog open={Boolean(receiptCollection)} onOpenChange={(o) => !o && onCloseReceipt()}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto print:max-w-full print:m-0 print:border-none print:shadow-none">
          {receiptCollection && receiptBooking && (
            <div className="space-y-4 text-foreground" id="printable-receipt">
              {/* Receipt Header */}
              <div className="border-b-2 border-border pb-3 flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <Building2 className="h-5 w-5 text-emerald-600" />
                    <span className="text-base font-bold text-foreground">
                      {orgName}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {receiptProject?.name ?? 'Real Estate Project'} • Official Customer Collection Receipt
                  </div>
                </div>
                <div className="text-right">
                  <span className="inline-block rounded-md bg-emerald-100 dark:bg-emerald-950 px-2 py-0.5 text-xs font-bold text-emerald-800 dark:text-emerald-300">
                    RECEIPT #{receiptCollection.receiptNumber || `BM-RCP-${receiptCollection.id.slice(0, 6).toUpperCase()}`}
                  </span>
                  <div className="text-[11px] text-muted-foreground mt-1">
                    Date: {new Date(receiptCollection.paidAt || receiptCollection.createdAt).toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })}
                  </div>
                </div>
              </div>

              {/* Customer & Unit Details */}
              <div className="grid grid-cols-2 gap-3 text-xs bg-muted/30 p-3 rounded-lg border border-border">
                <div>
                  <span className="text-muted-foreground block text-[10px] uppercase font-semibold">
                    Received From:
                  </span>
                  <div className="font-bold text-sm text-foreground">
                    {receiptBooking.customer.fullName}
                  </div>
                  <div className="text-muted-foreground">{receiptBooking.customer.phone}</div>
                  {receiptBooking.customer.email && (
                    <div className="text-muted-foreground">{receiptBooking.customer.email}</div>
                  )}
                  {receiptBooking.customer.permanentAddress && (
                    <div className="text-muted-foreground line-clamp-1">
                      {receiptBooking.customer.permanentAddress}
                    </div>
                  )}
                </div>

                <div className="text-right sm:text-left">
                  <span className="text-muted-foreground block text-[10px] uppercase font-semibold">
                    Allotted Unit / Property:
                  </span>
                  <div className="font-bold text-sm text-emerald-700 dark:text-emerald-400">
                    Flat {receiptBooking.unitNumber}
                  </div>
                  <div className="text-muted-foreground">
                    Project: {receiptProject?.name ?? 'Project'}
                  </div>
                  <div className="text-muted-foreground">
                    Booking #{receiptBooking.bookingNumber}
                  </div>
                </div>
              </div>

              {/* Payment Particulars Table */}
              <div className="rounded-lg border border-border overflow-hidden text-xs">
                <table className="w-full text-left">
                  <thead className="bg-secondary/60 border-b border-border text-[11px] font-semibold text-muted-foreground">
                    <tr>
                      <th className="p-2.5">Milestone / Description</th>
                      <th className="p-2.5">Mode & Ref</th>
                      <th className="p-2.5 text-right">Amount Received</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    <tr>
                      <td className="p-2.5">
                        <div className="font-semibold text-foreground">{receiptCollection.milestoneName}</div>
                        <div className="text-[11px] text-muted-foreground">Record Type: {receiptCollection.recordType}</div>
                      </td>
                      <td className="p-2.5">
                        <span className="font-medium text-foreground">{receiptCollection.paymentMode}</span>
                        {receiptCollection.instrumentRef ? (
                          <div className="text-[11px] text-muted-foreground">Ref: {receiptCollection.instrumentRef}</div>
                        ) : null}
                      </td>
                      <td className="p-2.5 text-right font-bold text-emerald-700 dark:text-emerald-400 text-sm">
                        {formatInr(receiptCollection.paidAmountInr)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Financial Balance Summary */}
              <div className="grid grid-cols-3 gap-2 bg-secondary/30 p-2.5 rounded-lg border border-border text-xs text-center">
                <div>
                  <span className="text-[10px] text-muted-foreground block">Total Contract Value</span>
                  <span className="font-bold">{formatInr(receiptBooking.totalPayableInr)}</span>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground block">Total Collected Till Date</span>
                  <span className="font-bold text-emerald-700 dark:text-emerald-400">
                    {formatInr(receiptBooking.totalCollectedVerifiedInr)}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground block">Remaining Outstanding</span>
                  <span className="font-bold text-amber-700 dark:text-amber-400">
                    {formatInr(receiptBooking.outstandingBalanceInr)}
                  </span>
                </div>
              </div>

              {/* Stamp & Authorized Signature */}
              <div className="flex items-center justify-between pt-3 border-t border-border text-xs">
                <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 font-semibold text-[11px]">
                  <ShieldCheck className="h-4 w-4" />
                  Verified & Digitally Stamped
                </div>
                <div className="text-right">
                  <div className="h-6 w-24 border-b border-muted-foreground/40 ml-auto" />
                  <span className="text-[10px] text-muted-foreground block mt-1">Authorized Signatory</span>
                </div>
              </div>

              <DialogFooter className="print:hidden gap-2">
                <Button variant="outline" size="sm" onClick={onCloseReceipt}>
                  Close
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1 text-emerald-700 dark:text-emerald-400 border-emerald-500/40"
                  onClick={handleShareReceiptWhatsApp}
                >
                  <MessageSquare className="h-3.5 w-3.5 text-emerald-600" />
                  Share Receipt (WA)
                </Button>
                <Button size="sm" className="gap-1 bg-primary text-primary-foreground font-semibold" onClick={handlePrint}>
                  <Printer className="h-3.5 w-3.5" />
                  Print Receipt / PDF
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Official Milestone Demand Notice Modal */}
      <Dialog open={Boolean(demandCollection)} onOpenChange={(o) => !o && onCloseDemand()}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto print:max-w-full print:m-0 print:border-none print:shadow-none">
          {demandCollection && demandBooking && (
            <div className="space-y-4 text-foreground" id="printable-demand">
              {/* Demand Header */}
              <div className="border-b-2 border-border pb-3 flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <Building2 className="h-5 w-5 text-primary" />
                    <span className="text-base font-bold text-foreground">
                      {orgName}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Construction Milestone Payment Demand Notice
                  </div>
                </div>
                <div className="text-right">
                  <span className="inline-block rounded-md bg-amber-100 dark:bg-amber-950 px-2 py-0.5 text-xs font-bold text-amber-800 dark:text-amber-300">
                    DEMAND #{`DMD-${demandCollection.id.slice(0, 6).toUpperCase()}`}
                  </span>
                  <div className="text-[11px] text-muted-foreground mt-1">
                    Notice Date: {new Date(demandCollection.createdAt).toLocaleDateString('en-IN')}
                  </div>
                </div>
              </div>

              {/* Customer & Unit Details */}
              <div className="grid grid-cols-2 gap-3 text-xs bg-muted/30 p-3 rounded-lg border border-border">
                <div>
                  <span className="text-muted-foreground block text-[10px] uppercase font-semibold">
                    To Buyer:
                  </span>
                  <div className="font-bold text-sm text-foreground">
                    {demandBooking.customer.fullName}
                  </div>
                  <div className="text-muted-foreground">{demandBooking.customer.phone}</div>
                  {demandBooking.customer.email && (
                    <div className="text-muted-foreground">{demandBooking.customer.email}</div>
                  )}
                </div>

                <div className="text-right sm:text-left">
                  <span className="text-muted-foreground block text-[10px] uppercase font-semibold">
                    Booked Property:
                  </span>
                  <div className="font-bold text-sm text-primary">
                    Flat {demandBooking.unitNumber}
                  </div>
                  <div className="text-muted-foreground">
                    {demandProject?.name ?? 'Real Estate Project'}
                  </div>
                  <div className="text-muted-foreground">
                    Booking #{demandBooking.bookingNumber}
                  </div>
                </div>
              </div>

              {/* Demand Details Card */}
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-xs space-y-2">
                <div className="font-semibold text-amber-900 dark:text-amber-200 text-sm">
                  Milestone Reached: {demandCollection.milestoneName}
                </div>
                <p className="text-muted-foreground leading-relaxed">
                  As per the construction schedule and agreement terms for Unit {demandBooking.unitNumber}, the milestone has been achieved. Kindly remit the due installment amount on or before the due date.
                </p>
                <div className="pt-2 flex items-center justify-between border-t border-amber-500/20 text-sm">
                  <span className="font-semibold text-foreground">Total Installment Due:</span>
                  <span className="font-bold text-lg text-amber-700 dark:text-amber-400">
                    {formatInr(demandCollection.demandAmountInr - (demandCollection.paidAmountInr || 0))}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground font-medium">
                  <span>Payment Deadline (Due Date):</span>
                  <span className="font-bold text-foreground">
                    {demandCollection.dueDate
                      ? new Date(demandCollection.dueDate).toLocaleDateString('en-IN', {
                          day: 'numeric',
                          month: 'long',
                          year: 'numeric',
                        })
                      : 'Within 15 days of notice'}
                  </span>
                </div>
              </div>

              {/* Escrow Bank Account Details */}
              <div className="rounded-lg border border-border bg-secondary/20 p-3 text-xs space-y-1">
                <span className="text-[10px] uppercase font-semibold text-muted-foreground block">
                  Remittance Bank Account (RERA Escrow Account):
                </span>
                <div className="grid grid-cols-2 gap-2 text-foreground font-medium pt-1">
                  <div>Account Name: <strong>{orgName} Escrow Account</strong></div>
                  <div>Bank Name: <strong>HDFC Bank / ICICI Bank</strong></div>
                  <div>Account Number: <strong>50200012345678</strong></div>
                  <div>IFSC Code: <strong>HDFC0000123</strong></div>
                </div>
              </div>

              <DialogFooter className="print:hidden gap-2">
                <Button variant="outline" size="sm" onClick={onCloseDemand}>
                  Close
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1 text-amber-700 dark:text-amber-400 border-amber-500/40"
                  onClick={handleShareDemandWhatsApp}
                >
                  <MessageSquare className="h-3.5 w-3.5 text-amber-600" />
                  Send via WhatsApp
                </Button>
                <Button size="sm" className="gap-1 bg-primary text-primary-foreground font-semibold" onClick={handlePrint}>
                  <Printer className="h-3.5 w-3.5" />
                  Print Demand Notice
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

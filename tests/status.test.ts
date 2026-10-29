import { describe, expect, it } from "vitest";
import {
  applyPayment,
  assertCanCancelInvoice,
  assertCanRevertToDraft,
  canTransitionInvoice,
  canTransitionQuotation,
  invoiceDisplayStatus,
  quotationDisplayStatus,
  removePayment,
  statusForPaidAmount,
  TransitionError,
} from "@/lib/status";

describe("invoice transitions", () => {
  it("allows the normal lifecycle", () => {
    expect(canTransitionInvoice("draft", "sent")).toBe(true);
    expect(canTransitionInvoice("sent", "partially_paid")).toBe(true);
    expect(canTransitionInvoice("partially_paid", "paid")).toBe(true);
    expect(canTransitionInvoice("sent", "paid")).toBe(true);
  });

  it("blocks invalid jumps", () => {
    expect(canTransitionInvoice("draft", "paid")).toBe(false);
    expect(canTransitionInvoice("paid", "cancelled")).toBe(false);
    expect(canTransitionInvoice("partially_paid", "cancelled")).toBe(false);
    expect(canTransitionInvoice("cancelled", "sent")).toBe(false);
    expect(canTransitionInvoice("cancelled", "draft")).toBe(false);
  });
});

describe("payments", () => {
  const sent = { status: "sent" as const, total: 10000, amountPaid: 0 };

  it("moves to partially paid, then paid", () => {
    const a = applyPayment(sent, 4000);
    expect(a).toEqual({ status: "partially_paid", amountPaid: 4000 });
    const b = applyPayment({ ...sent, ...a }, 6000);
    expect(b).toEqual({ status: "paid", amountPaid: 10000 });
  });

  it("supports full payment in one go", () => {
    expect(applyPayment(sent, 10000).status).toBe("paid");
  });

  it("rejects overpayment, zero and fractional amounts", () => {
    expect(() => applyPayment(sent, 10001)).toThrow(TransitionError);
    expect(() => applyPayment(sent, 0)).toThrow(TransitionError);
    expect(() => applyPayment(sent, 10.5)).toThrow(TransitionError);
  });

  it("rejects payments on draft, cancelled and paid invoices", () => {
    expect(() => applyPayment({ ...sent, status: "draft" }, 100)).toThrow(/sent/);
    expect(() => applyPayment({ ...sent, status: "cancelled" }, 100)).toThrow(/cancelled/);
    expect(() => applyPayment({ status: "paid", total: 100, amountPaid: 100 }, 1)).toThrow(/paid/);
  });

  it("removing a payment reopens the invoice", () => {
    expect(removePayment({ status: "paid", total: 10000, amountPaid: 10000 }, 4000)).toEqual({
      status: "partially_paid",
      amountPaid: 6000,
    });
    expect(removePayment({ status: "partially_paid", total: 10000, amountPaid: 4000 }, 4000)).toEqual({
      status: "sent",
      amountPaid: 0,
    });
    expect(() => removePayment({ status: "sent", total: 10000, amountPaid: 0 }, 1)).toThrow();
  });

  it("statusForPaidAmount", () => {
    expect(statusForPaidAmount(100, 0)).toBe("sent");
    expect(statusForPaidAmount(100, 50)).toBe("partially_paid");
    expect(statusForPaidAmount(100, 100)).toBe("paid");
  });
});

describe("cancel and revert", () => {
  it("can cancel unpaid draft or sent invoices", () => {
    expect(() => assertCanCancelInvoice({ status: "draft", amountPaid: 0 })).not.toThrow();
    expect(() => assertCanCancelInvoice({ status: "sent", amountPaid: 0 })).not.toThrow();
  });

  it("cannot cancel once money was received", () => {
    expect(() => assertCanCancelInvoice({ status: "partially_paid", amountPaid: 100 })).toThrow(/payments/);
    expect(() => assertCanCancelInvoice({ status: "paid", amountPaid: 100 })).toThrow();
  });

  it("can revert sent to draft only without payments", () => {
    expect(() => assertCanRevertToDraft({ status: "sent", amountPaid: 0 })).not.toThrow();
    expect(() => assertCanRevertToDraft({ status: "partially_paid", amountPaid: 1 })).toThrow();
    expect(() => assertCanRevertToDraft({ status: "cancelled", amountPaid: 0 })).toThrow();
  });
});

describe("derived statuses", () => {
  const today = "2026-10-29";

  it("marks unpaid invoices past due as overdue", () => {
    expect(invoiceDisplayStatus({ status: "sent", dueDate: "2026-10-28" }, today)).toBe("overdue");
    expect(invoiceDisplayStatus({ status: "partially_paid", dueDate: "2026-01-01" }, today)).toBe("overdue");
    expect(invoiceDisplayStatus({ status: "sent", dueDate: today }, today)).toBe("sent");
    expect(invoiceDisplayStatus({ status: "paid", dueDate: "2020-01-01" }, today)).toBe("paid");
    expect(invoiceDisplayStatus({ status: "draft", dueDate: "2020-01-01" }, today)).toBe("draft");
    expect(invoiceDisplayStatus({ status: "sent", dueDate: null }, today)).toBe("sent");
  });

  it("marks open quotations past validity as expired", () => {
    expect(quotationDisplayStatus({ status: "sent", dueDate: "2026-10-01" }, today)).toBe("expired");
    expect(quotationDisplayStatus({ status: "accepted", dueDate: "2026-10-01" }, today)).toBe("accepted");
  });

  it("quotation transitions", () => {
    expect(canTransitionQuotation("sent", "accepted")).toBe(true);
    expect(canTransitionQuotation("accepted", "converted")).toBe(true);
    expect(canTransitionQuotation("draft", "converted")).toBe(false);
    expect(canTransitionQuotation("converted", "draft")).toBe(false);
  });
});

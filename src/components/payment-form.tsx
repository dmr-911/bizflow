"use client";

import { useEffect, useRef } from "react";
import { useFormAction } from "./use-form-action";
import { recordPaymentAction } from "@/app/actions/documents";
import { minorToDecimalString, type Currency } from "@/lib/money";
import { PAYMENT_METHODS } from "@/lib/validation";
import { useI18n } from "./i18n-provider";
import { Alert, Button, Field, Input, Select } from "./ui";

export function PaymentForm({ invoiceId, balance, currency, today }: { invoiceId: number; balance: number; currency: Currency; today: string }) {
  const { t, fmt } = useI18n();
  const [state, onSubmit, pending] = useFormAction(recordPaymentAction.bind(null, invoiceId));
  const ref = useRef<HTMLFormElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  const err = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <form ref={ref} onSubmit={onSubmit} className="space-y-3">
      {state && !state.ok && <Alert tone="error">{state.error}</Alert>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field
          label={`${t.payments.amount} (${currency})`}
          htmlFor="pay-amount"
          error={err?.amount}
          hint={
            <button type="button" className="text-brand-600 hover:underline" onClick={() => amountRef.current && (amountRef.current.value = minorToDecimalString(balance, currency))}>
              {t.payments.fullAmount}: {fmt.money(balance, currency)}
            </button>
          }
        >
          <Input ref={amountRef} id="pay-amount" name="amount" inputMode="decimal" required className="tabular" />
        </Field>
        <Field label={t.payments.date} htmlFor="pay-date" error={err?.paidAt}>
          <Input id="pay-date" name="paidAt" type="date" defaultValue={today} required />
        </Field>
        <Field label={t.payments.method} htmlFor="pay-method" error={err?.method}>
          <Select id="pay-method" name="method" defaultValue="bank">
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {t.payments.methods[m]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t.payments.reference} htmlFor="pay-ref" error={err?.reference}>
          <Input id="pay-ref" name="reference" maxLength={120} />
        </Field>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? t.common.saving : t.payments.record}
      </Button>
    </form>
  );
}

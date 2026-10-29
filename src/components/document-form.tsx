"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useFieldArray, useForm, useWatch, type Control } from "react-hook-form";
import { saveDocumentAction } from "@/app/actions/documents";
import { calculateDocument, type LineInput } from "@/lib/calc";
import { CURRENCIES, parseMoney, parseScaled, type Currency } from "@/lib/money";
import type { DocumentKind } from "@/lib/services/documents";
import { documentSchema, type DocumentFormValues, type DocumentInput, type TaxRate } from "@/lib/validation";
import { Icon } from "./icons";
import { useI18n } from "./i18n-provider";
import { Alert, Button, Field, Input, LinkButton, Select, Textarea, cx } from "./ui";

type Item = DocumentFormValues["items"][number];

export interface DocumentFormProps {
  kind: DocumentKind;
  id: number | null;
  initial: DocumentFormValues;
  customers: { id: number; name: string; company: string }[];
  taxRates: TaxRate[];
  cancelHref: string;
}

/** Best-effort client-side preview; the server recalculates from scratch on save. */
function previewLines(items: Item[] | undefined, taxRates: TaxRate[]): LineInput[] {
  return (items ?? []).map((i) => {
    const percent = i.discountType !== "amount";
    const disc = String(i.discountValue ?? "").trim() || "0";
    return {
      quantityMilli: parseScaled(String(i.quantity ?? ""), 3) ?? 0,
      unitPrice: parseMoney(String(i.unitPrice ?? "")) ?? 0,
      discountType: percent ? "percent" : "amount",
      discountValue: (percent ? Math.min(parseScaled(disc, 2) ?? 0, 10_000) : parseMoney(disc)) ?? 0,
      taxRateBps: taxRates.find((t) => t.id === i.taxRateId)?.rateBps ?? 0,
    };
  });
}

function Totals({ control, taxRates }: { control: Control<DocumentFormValues, unknown, DocumentInput>; taxRates: TaxRate[] }) {
  const { t, fmt } = useI18n();
  const items = useWatch({ control, name: "items" });
  const currency = useWatch({ control, name: "currency" }) as Currency;
  let totals;
  try {
    totals = calculateDocument(previewLines(items, taxRates));
  } catch {
    totals = { subtotal: 0, discountTotal: 0, taxTotal: 0, total: 0, lines: [] };
  }
  const row = (label: string, v: number, strong = false) => (
    <div className={cx("flex justify-between gap-6", strong && "border-t border-slate-200 pt-2 text-base font-semibold text-slate-900")}>
      <dt>{label}</dt>
      <dd className="tabular">{fmt.money(v, currency)}</dd>
    </div>
  );
  return (
    <dl className="ml-auto w-full max-w-xs space-y-1.5 text-sm text-slate-600" aria-live="polite">
      {row(t.documents.subtotal, totals.subtotal)}
      {totals.discountTotal > 0 && row(`− ${t.documents.discountTotal}`, totals.discountTotal)}
      {row(t.documents.taxTotal, totals.taxTotal)}
      {row(t.documents.total, totals.total, true)}
    </dl>
  );
}

function LineTotal({ control, index, taxRates }: { control: Control<DocumentFormValues, unknown, DocumentInput>; index: number; taxRates: TaxRate[] }) {
  const { fmt } = useI18n();
  const item = useWatch({ control, name: `items.${index}` });
  const currency = useWatch({ control, name: "currency" }) as Currency;
  let total = 0;
  try {
    total = calculateDocument(previewLines([item], taxRates)).total;
  } catch {
    /* invalid input shows as zero */
  }
  return <span className="tabular">{fmt.money(total, currency)}</span>;
}

export function DocumentForm({ kind, id, initial, customers, taxRates, cancelHref }: DocumentFormProps) {
  const { t } = useI18n();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    control,
    getValues,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<DocumentFormValues, unknown, DocumentInput>({ resolver: zodResolver(documentSchema), defaultValues: initial });
  const { fields, append, remove } = useFieldArray({ control, name: "items" });
  const defaultTax = taxRates.find((r) => r.isDefault)?.id ?? "";

  const onSubmit = async () => {
    setServerError(null);
    // Send the raw strings; the server parses and validates them itself.
    const res = await saveDocumentAction(kind, id, getValues());
    if (res && !res.ok) {
      setServerError(res.error);
      for (const [k, msg] of Object.entries(res.fieldErrors ?? {})) setError(k as never, { message: msg });
    }
  };

  const itemErr = (i: number, k: keyof Item) => (errors.items?.[i] as Record<string, { message?: string }> | undefined)?.[k]?.message;

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-6">
      {serverError && <Alert tone="error">{serverError}</Alert>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={`${t.common.customer} *`} htmlFor="customerId" error={errors.customerId?.message} className="sm:col-span-2">
          <Select id="customerId" aria-invalid={!!errors.customerId} {...register("customerId")}>
            <option value="">{t.documents.chooseCustomer}</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.company ? ` — ${c.company}` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t.documents.issueDate} htmlFor="issueDate" error={errors.issueDate?.message}>
          <Input id="issueDate" type="date" aria-invalid={!!errors.issueDate} {...register("issueDate")} />
        </Field>
        <Field label={kind === "invoice" ? t.documents.dueDate : t.documents.validUntil} htmlFor="dueDate" error={errors.dueDate?.message}>
          <Input id="dueDate" type="date" aria-invalid={!!errors.dueDate} {...register("dueDate")} />
        </Field>
        <Field label={t.documents.currency} htmlFor="currency">
          <Select id="currency" {...register("currency")}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-slate-800">{t.documents.items}</legend>
        {typeof errors.items?.message === "string" && <p className="mb-2 text-sm text-red-600">{errors.items.message}</p>}
        <div className="space-y-3">
          {fields.map((field, i) => (
            <div key={field.id} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-12">
                <Field label={t.documents.description} htmlFor={`items.${i}.description`} error={itemErr(i, "description")} className="col-span-2 md:col-span-4">
                  <Input id={`items.${i}.description`} aria-invalid={!!itemErr(i, "description")} {...register(`items.${i}.description`)} />
                </Field>
                <Field label={t.documents.quantity} htmlFor={`items.${i}.quantity`} error={itemErr(i, "quantity")} className="md:col-span-1">
                  <Input id={`items.${i}.quantity`} inputMode="decimal" className="tabular text-right" aria-invalid={!!itemErr(i, "quantity")} {...register(`items.${i}.quantity`)} />
                </Field>
                <Field label={t.documents.unitPrice} htmlFor={`items.${i}.unitPrice`} error={itemErr(i, "unitPrice")} className="md:col-span-2">
                  <Input id={`items.${i}.unitPrice`} inputMode="decimal" className="tabular text-right" aria-invalid={!!itemErr(i, "unitPrice")} {...register(`items.${i}.unitPrice`)} />
                </Field>
                <Field label={t.documents.discount} htmlFor={`items.${i}.discountValue`} error={itemErr(i, "discountValue")} className="md:col-span-2">
                  <div className="flex">
                    <Input id={`items.${i}.discountValue`} inputMode="decimal" className="tabular rounded-r-none text-right" aria-invalid={!!itemErr(i, "discountValue")} {...register(`items.${i}.discountValue`)} />
                    <Select aria-label={t.documents.discount} className="w-20 rounded-l-none border-l-0 px-2" {...register(`items.${i}.discountType`)}>
                      <option value="percent">{t.documents.percent}</option>
                      <option value="amount">{t.documents.fixed}</option>
                    </Select>
                  </div>
                </Field>
                <Field label={t.documents.tax} htmlFor={`items.${i}.taxRateId`} className="md:col-span-2">
                  <Select id={`items.${i}.taxRateId`} {...register(`items.${i}.taxRateId`)}>
                    {taxRates.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className="col-span-2 flex items-end justify-between gap-2 md:col-span-1 md:flex-col md:items-end md:justify-end">
                  <span className="text-sm font-medium text-slate-800 md:pb-2">
                    <LineTotal control={control} index={i} taxRates={taxRates} />
                  </span>
                  <button
                    type="button"
                    onClick={() => remove(i)}
                    disabled={fields.length === 1}
                    className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                    aria-label={`${t.documents.removeLine} ${i + 1}`}
                    title={t.documents.removeLine}
                  >
                    <Icon name="trash" className="size-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="secondary"
          className="mt-3"
          onClick={() => append({ description: "", quantity: "1", unitPrice: "", discountType: "percent", discountValue: "0", taxRateId: defaultTax })}
        >
          <Icon name="plus" className="size-4" />
          {t.documents.addLine}
        </Button>
      </fieldset>

      <Totals control={control} taxRates={taxRates} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label={t.documents.notes} htmlFor="notes" error={errors.notes?.message}>
          <Textarea id="notes" rows={3} {...register("notes")} />
        </Field>
        <Field label={t.documents.terms} htmlFor="terms" error={errors.terms?.message}>
          <Textarea id="terms" rows={3} {...register("terms")} />
        </Field>
      </div>

      <div className="flex gap-2 border-t border-slate-100 pt-4">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? t.common.saving : t.common.save}
        </Button>
        <LinkButton href={cancelHref} variant="secondary">
          {t.common.cancel}
        </LinkButton>
      </div>
    </form>
  );
}

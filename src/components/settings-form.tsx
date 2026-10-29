"use client";

import { useState } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { saveSettingsAction } from "@/app/actions/settings";
import { DATE_FORMATS, formatDate } from "@/lib/dates";
import { LOCALES } from "@/lib/i18n";
import { CURRENCIES, parseScaled } from "@/lib/money";
import { formatDocumentNumber } from "@/lib/numbering";
import type { Settings } from "@/lib/validation";
import { Icon } from "./icons";
import { useI18n } from "./i18n-provider";
import { Alert, Button, Card, Field, Input, Select, Textarea } from "./ui";

type TaxRow = { id: string; name: string; rate: string };
type FormValues = Omit<Settings, "taxRates"> & { taxRates: TaxRow[]; defaultTax: string };

function toForm(s: Settings): FormValues {
  return {
    ...s,
    taxRates: s.taxRates.map((r) => ({ id: r.id, name: r.name, rate: String(r.rateBps / 100) })),
    defaultTax: s.taxRates.find((r) => r.isDefault)?.id ?? s.taxRates[0]?.id ?? "",
  };
}

export function SettingsForm({ initial }: { initial: Settings }) {
  const { t } = useI18n();
  const [result, setResult] = useState<{ ok: boolean; text: string; errors?: Record<string, string> } | null>(null);
  const { register, control, handleSubmit, formState } = useForm<FormValues>({ defaultValues: toForm(initial) });
  const taxes = useFieldArray({ control, name: "taxRates", keyName: "key" });
  const watched = useWatch({ control });

  const onSubmit = async (v: FormValues) => {
    setResult(null);
    const rates: Settings["taxRates"] = [];
    for (const r of v.taxRates) {
      const bps = parseScaled(r.rate || "0", 2);
      if (bps === null || bps > 10_000) {
        setResult({ ok: false, text: `${t.settings.taxRate}: "${r.rate}"` });
        return;
      }
      rates.push({ id: r.id, name: r.name, rateBps: bps, isDefault: r.id === v.defaultTax });
    }
    const { defaultTax, ...rest } = v;
    void defaultTax;
    const payload: Settings = {
      ...rest,
      taxRates: rates,
      paymentTermsDays: Number(v.paymentTermsDays),
      quotationValidityDays: Number(v.quotationValidityDays),
      invoiceNumbering: { ...v.invoiceNumbering, padding: Number(v.invoiceNumbering.padding), next: Number(v.invoiceNumbering.next) },
      quotationNumbering: { ...v.quotationNumbering, padding: Number(v.quotationNumbering.padding), next: Number(v.quotationNumbering.next) },
    };
    const res = await saveSettingsAction(payload);
    setResult(res.ok ? { ok: true, text: res.message ?? t.settings.saved } : { ok: false, text: res.error, errors: res.fieldErrors });
    if (res.ok) window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const err = (k: string) => result?.errors?.[k];
  const year = new Date().getFullYear();
  const preview = (k: "invoiceNumbering" | "quotationNumbering") => {
    const n = watched[k];
    if (!n) return "";
    return formatDocumentNumber(
      { prefix: n.prefix ?? "", padding: Number(n.padding) || 1, next: Number(n.next) || 1, includeYear: !!n.includeYear },
      Number(n.next) || 1,
      year,
    );
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
      {result && <Alert tone={result.ok ? "success" : "error"}>{result.text}</Alert>}

      <Card title={t.settings.business}>
        <p className="mb-4 text-xs text-slate-500">{t.settings.businessHelp}</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={`${t.settings.businessName} *`} htmlFor="b-name" error={err("business.name")}>
            <Input id="b-name" {...register("business.name")} />
          </Field>
          <Field label={t.settings.taxId} htmlFor="b-tax" error={err("business.taxId")}>
            <Input id="b-tax" {...register("business.taxId")} />
          </Field>
          <Field label={t.settings.email} htmlFor="b-email" error={err("business.email")}>
            <Input id="b-email" type="email" {...register("business.email")} />
          </Field>
          <Field label={t.settings.phone} htmlFor="b-phone" error={err("business.phone")}>
            <Input id="b-phone" {...register("business.phone")} />
          </Field>
          <Field label={t.settings.website} htmlFor="b-web" error={err("business.website")}>
            <Input id="b-web" {...register("business.website")} />
          </Field>
          <Field label={t.settings.address} htmlFor="b-addr" error={err("business.address")} className="sm:col-span-2">
            <Textarea id="b-addr" rows={2} {...register("business.address")} />
          </Field>
        </div>
      </Card>

      <Card title={t.settings.preferences}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label={t.settings.language} htmlFor="s-locale">
            <Select id="s-locale" {...register("locale")}>
              {LOCALES.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t.settings.defaultCurrency} htmlFor="s-cur">
            <Select id="s-cur" {...register("defaultCurrency")}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c === "BDT" ? "BDT (৳)" : "USD ($)"}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t.settings.dateFormat} htmlFor="s-date">
            <Select id="s-date" {...register("dateFormat")}>
              {DATE_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {formatDate("2026-03-25", f)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      <Card title={t.settings.numbering}>
        <p className="mb-4 text-xs text-slate-500">{t.settings.numberingHelp}</p>
        <div className="space-y-5">
          {(["invoiceNumbering", "quotationNumbering"] as const).map((k) => (
            <div key={k} className="grid grid-cols-2 items-end gap-3 sm:grid-cols-5">
              <Field label={k === "invoiceNumbering" ? t.settings.invoicePrefix : t.settings.quotationPrefix} htmlFor={`${k}-prefix`} error={err(`${k}.prefix`)}>
                <Input id={`${k}-prefix`} {...register(`${k}.prefix`)} />
              </Field>
              <Field label={t.settings.padding} htmlFor={`${k}-pad`} error={err(`${k}.padding`)}>
                <Input id={`${k}-pad`} type="number" min={1} max={10} {...register(`${k}.padding`)} />
              </Field>
              <Field label={t.settings.nextNumber} htmlFor={`${k}-next`} error={err(`${k}.next`)}>
                <Input id={`${k}-next`} type="number" min={1} {...register(`${k}.next`)} />
              </Field>
              <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
                <input type="checkbox" className="size-4 rounded border-slate-300" {...register(`${k}.includeYear`)} />
                {t.settings.includeYear}
              </label>
              <p className="col-span-2 text-sm sm:col-span-5">
                <span className="text-slate-500">{t.settings.preview}: </span>
                <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-slate-800">{preview(k)}</code>
              </p>
            </div>
          ))}
        </div>
      </Card>

      <Card title={t.settings.taxes}>
        <p className="mb-4 text-xs text-slate-500">{t.settings.taxesHelp}</p>
        <Field label={t.settings.taxLabel} htmlFor="tax-label" className="mb-4 max-w-xs" error={err("taxLabel")}>
          <Input id="tax-label" {...register("taxLabel")} />
        </Field>
        <div className="space-y-2">
          {taxes.fields.map((f, i) => (
            <div key={f.key} className="grid grid-cols-[1fr_6rem_auto_auto] items-center gap-2">
              <Input aria-label={t.settings.taxName} {...register(`taxRates.${i}.name`)} />
              <Input aria-label={t.settings.taxRate} inputMode="decimal" className="tabular text-right" {...register(`taxRates.${i}.rate`)} />
              <label className="flex items-center gap-1.5 text-sm text-slate-600">
                <input type="radio" value={f.id} {...register("defaultTax")} />
                {t.settings.default}
              </label>
              <button
                type="button"
                onClick={() => taxes.remove(i)}
                disabled={taxes.fields.length === 1}
                className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                aria-label={`${t.common.delete} ${f.name}`}
              >
                <Icon name="trash" className="size-4" />
              </button>
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="secondary"
          className="mt-3"
          onClick={() => taxes.append({ id: `tax${Date.now().toString(36)}`, name: "", rate: "0" })}
        >
          <Icon name="plus" className="size-4" />
          {t.settings.addTax}
        </Button>
      </Card>

      <Card title={t.settings.terms}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t.settings.paymentTerms} htmlFor="terms-days" error={err("paymentTermsDays")}>
            <Input id="terms-days" type="number" min={0} max={365} {...register("paymentTermsDays")} />
          </Field>
          <Field label={t.settings.quoteValidity} htmlFor="valid-days" error={err("quotationValidityDays")}>
            <Input id="valid-days" type="number" min={0} max={365} {...register("quotationValidityDays")} />
          </Field>
          <Field label={t.settings.invoiceTerms} htmlFor="inv-terms">
            <Textarea id="inv-terms" {...register("invoiceTerms")} />
          </Field>
          <Field label={t.settings.quotationTerms} htmlFor="q-terms">
            <Textarea id="q-terms" {...register("quotationTerms")} />
          </Field>
          <Field label={t.settings.footer} htmlFor="footer" className="sm:col-span-2">
            <Input id="footer" {...register("documentFooter")} />
          </Field>
        </div>
      </Card>

      <div className="sticky bottom-0 -mx-4 border-t border-slate-200 bg-slate-50/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-lg sm:border">
        <Button type="submit" disabled={formState.isSubmitting}>
          {formState.isSubmitting ? t.common.saving : t.common.save}
        </Button>
      </div>
    </form>
  );
}

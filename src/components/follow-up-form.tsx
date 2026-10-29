"use client";

import { useEffect, useRef } from "react";
import { useFormAction } from "./use-form-action";
import { createFollowUpAction } from "@/app/actions/followups";
import { useI18n } from "./i18n-provider";
import { Alert, Button, Field, Input, Select, Textarea } from "./ui";

export function FollowUpForm({
  customers,
  defaultCustomerId,
  documentId,
  defaultDate,
  compact,
}: {
  customers: { id: number; name: string; company: string }[];
  defaultCustomerId?: number;
  documentId?: number;
  defaultDate: string;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const [state, onSubmit, pending] = useFormAction(createFollowUpAction);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);
  const err = state && !state.ok ? state.fieldErrors : undefined;
  const uid = documentId
    ? `d${documentId}`
    : defaultCustomerId
      ? `c${defaultCustomerId}`
      : "g";

  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-3">
      <p className="text-sm font-semibold text-slate-800">{t.followUps.add}</p>
      {state && !state.ok && <Alert tone="error">{state.error}</Alert>}
      <div
        className={
          compact
            ? "grid grid-cols-1 gap-3"
            : "grid grid-cols-1 gap-3 sm:grid-cols-2"
        }
      >
        <Field
          className="sm:col-span-2"
          label={t.followUps.what}
          htmlFor={`fu-title-${uid}`}
          error={err?.title}
        >
          <Input id={`fu-title-${uid}`} name="title" required maxLength={200} />
        </Field>
        <Field
          label={t.followUps.due}
          htmlFor={`fu-date-${uid}`}
          error={err?.dueDate}
        >
          <Input
            id={`fu-date-${uid}`}
            name="dueDate"
            type="date"
            required
            defaultValue={defaultDate}
          />
        </Field>
        {defaultCustomerId ? (
          <input type="hidden" name="customerId" value={defaultCustomerId} />
        ) : (
          <Field
            label={t.common.customer}
            htmlFor={`fu-customer-${uid}`}
            error={err?.customerId}
          >
            <Select id={`fu-customer-${uid}`} name="customerId" defaultValue="">
              <option value="">{t.common.none}</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.company ? ` — ${c.company}` : ""}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {documentId && (
          <input type="hidden" name="documentId" value={documentId} />
        )}
        {!compact && (
          <Field
            label={t.followUps.note}
            htmlFor={`fu-note-${uid}`}
            error={err?.note}
            className="sm:col-span-2"
          >
            <Textarea id={`fu-note-${uid}`} name="note" rows={2} />
          </Field>
        )}
      </div>
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? t.common.saving : t.followUps.add}
      </Button>
    </form>
  );
}

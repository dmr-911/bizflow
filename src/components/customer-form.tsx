"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { saveCustomerAction } from "@/app/actions/customers";
import { customerSchema, type CustomerFormValues, type CustomerInput } from "@/lib/validation";
import { useI18n } from "./i18n-provider";
import { Alert, Button, Field, Input, LinkButton, Textarea } from "./ui";

export function CustomerForm({ id, initial }: { id: number | null; initial?: Partial<CustomerFormValues> }) {
  const { t } = useI18n();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CustomerFormValues, unknown, CustomerInput>({
    resolver: zodResolver(customerSchema),
    defaultValues: { name: "", company: "", email: "", phone: "", address: "", city: "", country: "", taxId: "", notes: "", ...initial },
  });

  const onSubmit = async (values: CustomerInput) => {
    setServerError(null);
    const res = await saveCustomerAction(id, values);
    if (res && !res.ok) {
      setServerError(res.error);
      for (const [k, msg] of Object.entries(res.fieldErrors ?? {})) setError(k as keyof CustomerFormValues, { message: msg });
    }
  };

  const f = (name: keyof CustomerFormValues) => ({ id: name, "aria-invalid": !!errors[name], ...register(name) });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
      {serverError && <Alert tone="error">{serverError}</Alert>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={`${t.customers.name} *`} htmlFor="name" error={errors.name?.message}>
          <Input {...f("name")} autoFocus />
        </Field>
        <Field label={t.customers.company} htmlFor="company" error={errors.company?.message}>
          <Input {...f("company")} />
        </Field>
        <Field label={t.customers.email} htmlFor="email" error={errors.email?.message}>
          <Input type="email" {...f("email")} />
        </Field>
        <Field label={t.customers.phone} htmlFor="phone" error={errors.phone?.message}>
          <Input type="tel" {...f("phone")} />
        </Field>
        <Field label={t.customers.address} htmlFor="address" error={errors.address?.message} className="sm:col-span-2">
          <Textarea rows={2} {...f("address")} />
        </Field>
        <Field label={t.customers.city} htmlFor="city" error={errors.city?.message}>
          <Input {...f("city")} />
        </Field>
        <Field label={t.customers.country} htmlFor="country" error={errors.country?.message}>
          <Input {...f("country")} />
        </Field>
        <Field label={t.customers.taxId} htmlFor="taxId" error={errors.taxId?.message}>
          <Input {...f("taxId")} />
        </Field>
        <Field label={t.customers.notes} htmlFor="notes" error={errors.notes?.message} className="sm:col-span-2">
          <Textarea rows={4} {...f("notes")} />
        </Field>
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? t.common.saving : t.common.save}
        </Button>
        <LinkButton href={id ? `/customers/${id}` : "/customers"} variant="secondary">
          {t.common.cancel}
        </LinkButton>
      </div>
    </form>
  );
}

"use client";

import { deleteAccountAction } from "@/app/actions/auth";
import { DangerForm } from "./data-panel";
import { useI18n } from "./i18n-provider";
import { Field, Input } from "./ui";

export function DeleteAccountForm() {
  const { t } = useI18n();
  return (
    <DangerForm action={deleteAccountAction} word="DELETE" title={t.billing.deleteTitle} help={t.billing.deleteText} button={t.billing.deleteButton}>
      <Field label={t.auth.password} htmlFor="delete-password" className="max-w-xs">
        <Input id="delete-password" name="password" type="password" autoComplete="current-password" required />
      </Field>
    </DangerForm>
  );
}

"use client";

import { useFormAction } from "./use-form-action";
import { changePasswordAction } from "@/app/actions/auth";
import { loadDemoAction, resetDataAction, restoreBackupAction } from "@/app/actions/settings";
import { interpolate } from "@/lib/i18n";
import type { ActionResult } from "@/lib/server/action";
import { Icon } from "./icons";
import { useI18n } from "./i18n-provider";
import { Alert, Button, Card, Field, Input } from "./ui";

function Result({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return <Alert tone={state.ok ? "success" : "error"}>{state.ok ? state.message : state.error}</Alert>;
}

function DangerForm({
  action,
  word,
  title,
  help,
  button,
  children,
}: {
  action: (s: ActionResult | null, f: FormData) => Promise<ActionResult>;
  word: string;
  title: string;
  help: string;
  button: string;
  children?: React.ReactNode;
}) {
  const { t } = useI18n();
  const [state, onSubmit, pending] = useFormAction(action);
  const id = `confirm-${word}`;
  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-md border border-slate-200 p-4">
      <div>
        <p className="text-sm font-semibold text-slate-800">{title}</p>
        <p className="text-xs text-slate-500">{help}</p>
      </div>
      <Result state={state} />
      {children}
      <div className="flex flex-wrap items-end gap-2">
        <Field label={interpolate(t.settings.typeToConfirm, { word })} htmlFor={id} className="w-48">
          <Input id={id} name="confirm" autoComplete="off" placeholder={word} />
        </Field>
        <Button type="submit" variant="danger" disabled={pending}>
          {pending ? t.common.loading : button}
        </Button>
      </div>
    </form>
  );
}

export function DataPanel() {
  const { t } = useI18n();
  const [pw, pwSubmit, pwPending] = useFormAction(changePasswordAction);
  return (
    <div className="space-y-6">
      <Card title={t.settings.data}>
        <p className="mb-4 text-sm text-slate-600">{t.settings.dataHelp}</p>
        <a href="/api/backup" className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700">
          <Icon name="download" className="size-4" />
          {t.settings.downloadBackup}
        </a>
        <div className="mt-5 space-y-4">
          <DangerForm action={restoreBackupAction} word="RESTORE" title={t.settings.restoreBackup} help={t.settings.restoreHelp} button={t.settings.restoreBackup}>
            <Input type="file" name="file" accept="application/json,.json" aria-label={t.settings.restoreBackup} />
          </DangerForm>
          <DangerForm action={loadDemoAction} word="DEMO" title={t.settings.loadDemo} help={t.settings.loadDemoHelp} button={t.settings.loadDemo} />
          <DangerForm action={resetDataAction} word="RESET" title={t.settings.reset} help={t.settings.resetHelp} button={t.settings.reset} />
        </div>
      </Card>

      <Card title={t.settings.account}>
        <form onSubmit={pwSubmit} className="max-w-sm space-y-3">
          <p className="text-sm font-semibold text-slate-800">{t.settings.changePassword}</p>
          <Result state={pw} />
          <Field label={t.settings.currentPassword} htmlFor="pw-current" error={pw && !pw.ok ? pw.fieldErrors?.current : undefined}>
            <Input id="pw-current" name="current" type="password" autoComplete="current-password" required />
          </Field>
          <Field label={t.settings.newPassword} htmlFor="pw-next" error={pw && !pw.ok ? pw.fieldErrors?.next : undefined}>
            <Input id="pw-next" name="next" type="password" autoComplete="new-password" minLength={10} required />
          </Field>
          <Button type="submit" variant="secondary" disabled={pwPending}>
            {t.settings.changePassword}
          </Button>
        </form>
      </Card>
    </div>
  );
}

"use client";

import { useFormAction } from "./use-form-action";
import type { ActionResult } from "@/lib/server/action";
import { Alert, Button, Field, Input } from "./ui";

export function AuthForm({
  action,
  labels,
  newPassword,
}: {
  action: (s: ActionResult | null, f: FormData) => Promise<ActionResult>;
  labels: { username: string; password: string; submit: string };
  newPassword?: boolean;
}) {
  const [state, onSubmit, pending] = useFormAction(action);
  const errors = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {state && !state.ok && <Alert tone="error">{state.error}</Alert>}
      <Field label={labels.username} htmlFor="username" error={errors?.username}>
        <Input id="username" name="username" autoComplete="username" required autoFocus />
      </Field>
      <Field label={labels.password} htmlFor="password" error={errors?.password} hint={newPassword ? "At least 10 characters." : undefined}>
        <Input id="password" name="password" type="password" autoComplete={newPassword ? "new-password" : "current-password"} required minLength={newPassword ? 10 : undefined} />
      </Field>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "…" : labels.submit}
      </Button>
    </form>
  );
}

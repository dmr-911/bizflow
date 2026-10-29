"use client";

import Link from "next/link";
import { useState, type ComponentProps } from "react";
import { forgotPasswordAction, loginAction, resetPasswordAction, signupAction } from "@/app/actions/auth";
import type { Dictionary } from "@/lib/i18n";
import { Icon } from "./icons";
import { Alert, Button, cx, Field, Input } from "./ui";
import { useFormAction } from "./use-form-action";

type AuthText = Dictionary["auth"];

function PasswordInput({ t, ...props }: ComponentProps<"input"> & { t: AuthText }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={visible ? "text" : "password"} className="pr-10" />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600"
        aria-label={visible ? t.hidePassword : t.showPassword}
        aria-pressed={visible}
      >
        <Icon name={visible ? "eyeOff" : "eye"} className="size-4" />
      </button>
    </div>
  );
}

function Submit({ pending, children }: { pending: boolean; children: string }) {
  return (
    <Button type="submit" className="w-full py-2.5" disabled={pending} aria-busy={pending}>
      {pending && <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />}
      {children}
    </Button>
  );
}

const big = "py-2.5";

export function LoginForm({ t, next }: { t: AuthText; next?: string }) {
  const [state, onSubmit, pending] = useFormAction(loginAction);
  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {state && !state.ok && <Alert tone="error">{state.error}</Alert>}
      {next && <input type="hidden" name="next" value={next} />}
      <Field label={t.email} htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" required autoFocus className={big} />
      </Field>
      <div>
        <div className="mb-1 flex items-center justify-between">
          <label htmlFor="password" className="text-sm font-medium text-slate-700">
            {t.password}
          </label>
          <Link href="/forgot-password" className="text-sm font-medium text-brand-600 hover:text-brand-700">
            {t.forgot}
          </Link>
        </div>
        <PasswordInput t={t} id="password" name="password" autoComplete="current-password" required className={big} />
      </div>
      <Submit pending={pending}>{t.login}</Submit>
    </form>
  );
}

export function SignupForm({ t }: { t: AuthText }) {
  const [state, onSubmit, pending] = useFormAction(signupAction);
  const errors = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {state && !state.ok && <Alert tone="error">{state.error}</Alert>}
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={t.name} htmlFor="name" error={errors?.name}>
          <Input id="name" name="name" autoComplete="name" required maxLength={80} autoFocus aria-invalid={!!errors?.name} className={big} />
        </Field>
        <Field label={t.businessName} htmlFor="businessName" error={errors?.businessName}>
          <Input id="businessName" name="businessName" autoComplete="organization" required maxLength={120} aria-invalid={!!errors?.businessName} className={big} />
        </Field>
      </div>
      <Field label={t.email} htmlFor="email" error={errors?.email}>
        <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" required aria-invalid={!!errors?.email} className={big} />
      </Field>
      <Field label={t.password} htmlFor="password" error={errors?.password} hint={t.passwordHint}>
        <PasswordInput t={t} id="password" name="password" autoComplete="new-password" required minLength={10} aria-invalid={!!errors?.password} className={big} />
      </Field>
      {/* Honeypot: hidden from people and screen readers, filled in by bots. */}
      <div className="hidden" aria-hidden>
        <label htmlFor="website">Website</label>
        <input id="website" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      <div>
        <label className="flex items-start gap-2.5 text-sm text-slate-600">
          <input
            type="checkbox"
            name="terms"
            required
            className={cx("mt-0.5 size-4 rounded border-slate-300 text-brand-600", errors?.terms && "outline outline-red-400")}
            aria-invalid={!!errors?.terms}
          />
          <span>
            {t.agreePrefix}{" "}
            <Link href="/terms" target="_blank" className="font-medium text-brand-600 hover:underline">
              {t.termsLink}
            </Link>{" "}
            {t.and}{" "}
            <Link href="/privacy" target="_blank" className="font-medium text-brand-600 hover:underline">
              {t.privacyLink}
            </Link>
            .
          </span>
        </label>
        {errors?.terms && (
          <p className="mt-1 text-xs text-red-600" role="alert">
            {errors.terms}
          </p>
        )}
      </div>
      <Submit pending={pending}>{t.signupButton}</Submit>
    </form>
  );
}

export function ForgotForm({ t }: { t: AuthText }) {
  const [state, onSubmit, pending] = useFormAction(forgotPasswordAction);
  if (state?.ok) {
    return (
      <div className="space-y-5">
        <Alert tone="success">{state.message}</Alert>
        <Link href="/login" className="block text-center text-sm font-medium text-brand-600 hover:text-brand-700">
          ← {t.backToLogin}
        </Link>
      </div>
    );
  }
  const errors = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {state && !state.ok && !errors && <Alert tone="error">{state.error}</Alert>}
      <Field label={t.email} htmlFor="email" error={errors?.email}>
        <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" required autoFocus aria-invalid={!!errors?.email} className={big} />
      </Field>
      <Submit pending={pending}>{t.forgotButton}</Submit>
    </form>
  );
}

export function ResetForm({ t, token }: { t: AuthText; token: string }) {
  const [state, onSubmit, pending] = useFormAction(resetPasswordAction);
  const errors = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {state && !state.ok && !errors && <Alert tone="error">{state.error}</Alert>}
      <input type="hidden" name="token" value={token} />
      <Field label={t.newPassword} htmlFor="password" error={errors?.password} hint={t.passwordHint}>
        <PasswordInput t={t} id="password" name="password" autoComplete="new-password" required minLength={10} autoFocus className={big} />
      </Field>
      <Submit pending={pending}>{t.resetButton}</Submit>
    </form>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { ResetForm } from "@/components/auth-forms";
import { Alert } from "@/components/ui";
import { getControlDb } from "@/lib/db";
import { getDictionary } from "@/lib/i18n";
import { isResetTokenValid } from "@/lib/services/auth";
import { visitorLocale } from "@/lib/server/context";

export const metadata: Metadata = { title: "Choose a new password", robots: { index: false }, referrer: "no-referrer" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const locale = await visitorLocale();
  const t = getDictionary(locale);
  const token = (await searchParams).token ?? "";
  const valid = token !== "" && isResetTokenValid(getControlDb(), token);
  return (
    <AuthShell t={t} locale={locale} title={t.auth.resetTitle} text={t.auth.resetText}>
      {valid ? (
        <ResetForm t={t.auth} token={token} />
      ) : (
        <div className="space-y-5">
          <Alert tone="error">{t.auth.resetInvalid}</Alert>
          <Link href="/forgot-password" className="block text-center text-sm font-semibold text-brand-600 hover:text-brand-700">
            {t.auth.forgotButton}
          </Link>
        </div>
      )}
    </AuthShell>
  );
}

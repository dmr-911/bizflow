import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { ForgotForm } from "@/components/auth-forms";
import { getDictionary } from "@/lib/i18n";
import { visitorLocale } from "@/lib/server/context";

export const metadata: Metadata = { title: "Reset password", robots: { index: false } };

export default async function ForgotPasswordPage() {
  const locale = await visitorLocale();
  const t = getDictionary(locale);
  return (
    <AuthShell
      t={t}
      locale={locale}
      title={t.auth.forgotTitle}
      text={t.auth.forgotText}
      footer={
        <Link href="/login" className="font-semibold text-brand-600 hover:text-brand-700">
          ← {t.auth.backToLogin}
        </Link>
      }
    >
      <ForgotForm t={t.auth} />
    </AuthShell>
  );
}

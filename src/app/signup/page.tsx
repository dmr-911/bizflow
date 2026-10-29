import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { SignupForm } from "@/components/auth-forms";
import { getDictionary, interpolate } from "@/lib/i18n";
import { toBanglaDigits } from "@/lib/money";
import { trialDays } from "@/lib/services/billing";
import { currentUser, visitorLocale } from "@/lib/server/context";

export const metadata: Metadata = {
  title: "Start your free trial",
  description: "Create a BizFlow account for your business. Free trial, no card needed.",
  alternates: { canonical: "/signup" },
};

export default async function SignupPage() {
  if (await currentUser()) redirect("/dashboard");
  const locale = await visitorLocale();
  const t = getDictionary(locale);
  const days = trialDays();
  return (
    <AuthShell
      t={t}
      locale={locale}
      title={days > 0 ? interpolate(t.auth.signupTitle, { days: locale === "bn" ? toBanglaDigits(String(days)) : days }) : t.auth.createAccount}
      text={t.auth.signupText}
      footer={
        <>
          {t.auth.haveAccount}{" "}
          <Link href="/login" className="font-semibold text-brand-600 hover:text-brand-700">
            {t.auth.login}
          </Link>
        </>
      }
    >
      <SignupForm t={t.auth} />
    </AuthShell>
  );
}

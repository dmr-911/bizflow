import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { LoginForm } from "@/components/auth-forms";
import { getDictionary } from "@/lib/i18n";
import { currentUser, visitorLocale } from "@/lib/server/context";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to BizFlow to manage your customers, quotations and invoices.",
  alternates: { canonical: "/login" },
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await currentUser()) redirect("/dashboard");
  const locale = await visitorLocale();
  const t = getDictionary(locale);
  const { next } = await searchParams;
  return (
    <AuthShell
      t={t}
      locale={locale}
      title={t.auth.loginTitle}
      text={t.auth.signInText}
      footer={
        <>
          {t.auth.noAccount}{" "}
          <Link href="/signup" className="font-semibold text-brand-600 hover:text-brand-700">
            {t.auth.createAccount}
          </Link>
        </>
      }
    >
      <LoginForm t={t.auth} next={next?.startsWith("/") && !next.startsWith("//") ? next : undefined} />
    </AuthShell>
  );
}

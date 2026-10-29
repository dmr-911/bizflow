import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Icon, type IconName } from "@/components/icons";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { Alert, cx } from "@/components/ui";
import { toBanglaDigits } from "@/lib/money";
import { getDictionary, interpolate } from "@/lib/i18n";
import { PLAN, trialDays } from "@/lib/services/billing";
import { currentUser, visitorLocale } from "@/lib/server/context";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: { absolute: "BizFlow: invoices, quotations and follow-ups for small businesses" },
  alternates: { canonical: "/" },
};

const PROBLEM_ICONS: IconName[] = ["quotations", "invoices", "bell", "globe"];
const FEATURE_ICONS: IconName[] = ["customers", "quotations", "billing", "followUps", "reports", "globe"];

function Section({ id, eyebrow, title, text, children, className }: { id?: string; eyebrow?: string; title: string; text?: string; children: React.ReactNode; className?: string }) {
  return (
    <section id={id} className={cx("scroll-mt-20 py-20 sm:py-24", className)}>
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          {eyebrow && <p className="text-sm font-semibold uppercase tracking-wider text-brand-600">{eyebrow}</p>}
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">{title}</h2>
          {text && <p className="mt-4 text-lg leading-8 text-slate-600">{text}</p>}
        </div>
        <div className="mt-14">{children}</div>
      </div>
    </section>
  );
}

function BrowserFrame({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cx("overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/10 ring-1 ring-slate-900/5", className)}>
      <div className="flex items-center gap-1.5 border-b border-slate-200 bg-slate-50 px-4 py-2.5" aria-hidden>
        <span className="size-2.5 rounded-full bg-slate-300" />
        <span className="size-2.5 rounded-full bg-slate-300" />
        <span className="size-2.5 rounded-full bg-slate-300" />
      </div>
      {children}
    </div>
  );
}

export default async function LandingPage({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
  const locale = await visitorLocale();
  const t = getDictionary(locale);
  const m = t.marketing;
  const signedIn = !!(await currentUser());
  const days = trialDays();
  const num = (n: number) => (locale === "bn" ? toBanglaDigits(String(n)) : String(n));
  const vars = { days: num(days), bdt: num(PLAN.bdtPoisha / 100) };
  const ctaHref = signedIn ? "/dashboard" : "/signup";
  const { deleted } = await searchParams;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "BizFlow",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    url: site.url,
    description: "Customers, quotations, invoices, payments and follow-ups for small businesses, in English and Bangla.",
    offers: { "@type": "Offer", price: (PLAN.usdCents / 100).toFixed(2), priceCurrency: "USD", category: "subscription" },
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <SiteHeader t={t} locale={locale} signedIn={signedIn} />
      <main className="bg-white">
        {deleted && (
          <div className="mx-auto max-w-6xl px-4 pt-6 sm:px-6">
            <Alert tone="info">{m.deleted}</Alert>
          </div>
        )}

        {/* Hero */}
        <section className="relative overflow-hidden">
          <div
            className="absolute inset-0 -z-10 bg-[linear-gradient(to_right,#e2e8f0_1px,transparent_1px),linear-gradient(to_bottom,#e2e8f0_1px,transparent_1px)] bg-[size:48px_48px] [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,#000_60%,transparent_100%)] opacity-60"
            aria-hidden
          />
          <div className="absolute -top-40 left-1/2 -z-10 h-[32rem] w-[64rem] -translate-x-1/2 rounded-full bg-brand-100/60 blur-3xl" aria-hidden />
          <div className="mx-auto grid max-w-6xl items-center gap-14 px-4 pb-20 pt-16 sm:px-6 sm:pt-24 lg:grid-cols-[1.05fr_1fr] lg:pb-28">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-brand-100 bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">
                <span className="size-1.5 rounded-full bg-brand-500" aria-hidden />
                {m.hero.eyebrow}
              </p>
              <h1 className="mt-6 text-4xl font-semibold leading-[1.1] tracking-tight text-slate-900 sm:text-5xl lg:text-[3.4rem]">{m.hero.title}</h1>
              <p className="mt-6 max-w-xl text-lg leading-8 text-slate-600">{m.hero.text}</p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Link href={ctaHref} className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-6 py-3 text-base font-semibold text-white shadow-lg shadow-brand-600/25 transition hover:bg-brand-700">
                  {signedIn ? m.nav.dashboard : m.hero.cta}
                  <Icon name="arrowRight" className="size-4" />
                </Link>
                <Link href="#how" className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-6 py-3 text-base font-semibold text-slate-700 transition hover:bg-slate-50">
                  {m.hero.secondary}
                </Link>
              </div>
              <p className="mt-5 text-sm text-slate-500">{interpolate(m.hero.note, vars)}</p>
            </div>
            <BrowserFrame className="lg:translate-x-6">
              <Image src="/screens/dashboard.png" alt={m.hero.imageAlt} width={1360} height={1100} priority sizes="(min-width: 1024px) 560px, 100vw" className="h-auto w-full" />
            </BrowserFrame>
          </div>
        </section>

        {/* Problem */}
        <Section eyebrow={m.problem.eyebrow} title={m.problem.title} text={m.problem.text} className="bg-slate-50">
          <div className="grid gap-5 sm:grid-cols-2">
            {m.problem.items.map((p, i) => (
              <div key={p.title} className="flex gap-4 rounded-xl border border-slate-200 bg-white p-6">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-600">
                  <Icon name={PROBLEM_ICONS[i] ?? "bell"} />
                </span>
                <div>
                  <h3 className="font-semibold text-slate-900">{p.title}</h3>
                  <p className="mt-1.5 text-sm leading-6 text-slate-600">{p.text}</p>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* Features */}
        <Section id="features" eyebrow={m.features.eyebrow} title={m.features.title} text={m.features.text}>
          <div className="grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {m.features.items.map((f, i) => (
              <div key={f.title}>
                <span className="flex size-11 items-center justify-center rounded-lg bg-brand-600 text-white shadow-sm">
                  <Icon name={FEATURE_ICONS[i] ?? "check"} />
                </span>
                <h3 className="mt-4 font-semibold text-slate-900">{f.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{f.text}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* Showcase */}
        <section className="overflow-hidden bg-slate-900 py-20 sm:py-24">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">{m.showcase.title}</h2>
              <p className="mt-4 text-lg leading-8 text-slate-300">{m.showcase.text}</p>
              <div className="mt-10 rounded-xl border border-white/10 bg-white/5 p-5">
                <p className="font-semibold text-white" lang="bn">{m.showcase.banglaTitle}</p>
                <p className="mt-1 text-sm text-slate-300">{m.showcase.banglaText}</p>
                <Image src="/screens/dashboard-bangla.png" alt={m.showcase.banglaAlt} width={1360} height={1100} sizes="(min-width: 1024px) 480px, 100vw" className="mt-4 h-auto w-full rounded-lg border border-white/10" />
              </div>
            </div>
            <BrowserFrame className="border-slate-700">
              <Image src="/screens/invoice.png" alt={m.showcase.invoiceAlt} width={1360} height={1097} sizes="(min-width: 1024px) 560px, 100vw" className="h-auto w-full" />
            </BrowserFrame>
          </div>
        </section>

        {/* How it works */}
        <Section id="how" eyebrow={m.how.eyebrow} title={m.how.title}>
          <ol className="grid gap-6 md:grid-cols-3">
            {m.how.steps.map((s, i) => (
              <li key={s.title} className="relative rounded-xl border border-slate-200 bg-white p-6">
                <span className="flex size-9 items-center justify-center rounded-full bg-brand-50 text-sm font-bold text-brand-700 ring-1 ring-brand-100">{num(i + 1)}</span>
                <h3 className="mt-4 font-semibold text-slate-900">{s.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{s.text}</p>
              </li>
            ))}
          </ol>
        </Section>

        {/* Pricing */}
        <Section id="pricing" eyebrow={m.pricing.eyebrow} title={m.pricing.title} text={m.pricing.text} className="bg-slate-50">
          <div className="mx-auto max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/5">
            <div className="p-8 sm:p-10">
              <h3 className="text-lg font-semibold text-brand-700">{m.pricing.plan}</h3>
              <p className="mt-4 flex items-baseline gap-1.5">
                <span className="text-5xl font-semibold tracking-tight text-slate-900">{m.pricing.price}</span>
                <span className="text-base text-slate-500">{m.pricing.per}</span>
              </p>
              <p className="mt-1 text-sm text-slate-600">{interpolate(m.pricing.bdt, vars)}</p>
              <ul className="mt-8 space-y-3">
                {m.pricing.items.split("|").map((item) => (
                  <li key={item} className="flex items-start gap-3 text-sm text-slate-700">
                    <Icon name="check" className="mt-0.5 size-4 shrink-0 text-brand-600" />
                    {item}
                  </li>
                ))}
              </ul>
              <Link href={ctaHref} className="mt-9 flex w-full items-center justify-center rounded-lg bg-brand-600 px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-brand-700">
                {signedIn ? m.nav.dashboard : interpolate(m.pricing.cta, vars)}
              </Link>
              <p className="mt-3 text-center text-xs text-slate-500">{m.pricing.note}</p>
            </div>
            <div className="flex items-center justify-center gap-3 border-t border-slate-100 bg-slate-50 px-8 py-4 text-xs font-medium text-slate-500">
              <span>Visa · Mastercard · Amex</span>
              <span aria-hidden>·</span>
              <span className="rounded bg-[#e2136e] px-1.5 py-0.5 font-bold text-white">bKash</span>
            </div>
          </div>
        </Section>

        {/* FAQ */}
        <Section id="faq" title={m.faq.title}>
          <div className="mx-auto max-w-3xl divide-y divide-slate-200 rounded-xl border border-slate-200">
            {m.faq.items.map((f) => (
              <details key={f.q} className="group px-6 py-5 [&_summary::-webkit-details-marker]:hidden">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium text-slate-900">
                  {f.q}
                  <Icon name="plus" className="size-4 shrink-0 text-slate-400 transition group-open:rotate-45" />
                </summary>
                <p className="mt-3 text-sm leading-6 text-slate-600">{interpolate(f.a, vars)}</p>
              </details>
            ))}
          </div>
        </Section>

        {/* Final call to action */}
        <section className="px-4 pb-20 sm:px-6 sm:pb-24">
          <div className="relative mx-auto max-w-6xl overflow-hidden rounded-2xl bg-brand-700 px-6 py-14 text-center sm:px-12">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(255,255,255,0.18),transparent_50%)]" aria-hidden />
            <h2 className="relative mx-auto max-w-2xl text-3xl font-semibold tracking-tight text-white sm:text-4xl">{m.final.title}</h2>
            <p className="relative mx-auto mt-4 max-w-xl text-lg text-brand-100">{m.final.text}</p>
            <Link href={ctaHref} className="relative mt-8 inline-flex items-center gap-2 rounded-lg bg-white px-6 py-3 text-base font-semibold text-brand-700 shadow-sm transition hover:bg-brand-50">
              {signedIn ? m.nav.dashboard : m.final.cta}
              <Icon name="arrowRight" className="size-4" />
            </Link>
            <p className="relative mt-4 text-sm text-brand-100">{interpolate(m.hero.note, vars)}</p>
          </div>
        </section>
      </main>
      <SiteFooter t={t} locale={locale} />
    </>
  );
}

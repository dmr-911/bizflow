import Link from "next/link";
import { interpolate, type Dictionary, type Locale } from "@/lib/i18n";
import { site } from "@/lib/site";
import { Brand } from "../brand";
import { LocaleSwitch } from "../locale-switch";

export function SiteFooter({ t, locale }: { t: Dictionary; locale: Locale }) {
  const f = t.marketing.footer;
  const n = t.marketing.nav;
  const col = "space-y-2.5 text-sm";
  const link = "text-slate-600 transition hover:text-slate-900";
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-4">
        <div className="md:col-span-2">
          <Brand />
          <p className="mt-3 max-w-xs text-sm text-slate-600">{f.tagline}</p>
          <LocaleSwitch locale={locale} className="mt-5" />
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-900">{f.product}</p>
          <ul className={`mt-3 ${col}`}>
            <li><Link className={link} href="/#features">{n.features}</Link></li>
            <li><Link className={link} href="/#pricing">{n.pricing}</Link></li>
            <li><Link className={link} href="/#faq">{n.faq}</Link></li>
            <li><Link className={link} href="/signup">{n.start}</Link></li>
          </ul>
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-900">{f.legal}</p>
          <ul className={`mt-3 ${col}`}>
            <li><Link className={link} href="/terms">{f.terms}</Link></li>
            <li><Link className={link} href="/privacy">{f.privacy}</Link></li>
            <li><Link className={link} href="/refund">{f.refund}</Link></li>
            <li><a className={link} href={`mailto:${site.supportEmail}`}>{f.contact}</a></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-slate-100">
        <p className="mx-auto max-w-6xl px-4 py-6 text-xs text-slate-500 sm:px-6">{interpolate(f.rights, { year: new Date().getFullYear() })}</p>
      </div>
    </footer>
  );
}

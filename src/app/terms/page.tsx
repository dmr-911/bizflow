import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/marketing/legal-page";
import { PLAN, trialDays } from "@/lib/services/billing";
import { site } from "@/lib/site";

export const metadata: Metadata = { title: "Terms of Service", alternates: { canonical: "/terms" } };

export default function TermsPage() {
  const email = site.supportEmail;
  return (
    <LegalPage title="Terms of Service">
      <p>
        These terms govern your use of BizFlow (the &quot;Service&quot;), provided by {site.company} (&quot;we&quot;, &quot;us&quot;). By creating an account you agree to them. If you
        use the Service for a business, you accept these terms on behalf of that business.
      </p>

      <h2>1. Your account</h2>
      <ul>
        <li>You must give accurate information when you sign up and keep your password secure.</li>
        <li>You are responsible for everything done with your account. Tell us at <a href={`mailto:${email}`}>{email}</a> if you think it has been misused.</li>
        <li>You must be at least 18 years old, or the age of majority where you live.</li>
      </ul>

      <h2>2. Free trial and subscription</h2>
      <ul>
        <li>New accounts get a free trial of {trialDays()} days. No payment details are needed for the trial.</li>
        <li>
          After the trial the Service costs US${(PLAN.usdCents / 100).toFixed(2)} per month by card, or ৳{PLAN.bdtPoisha / 100} per month by bKash. Prices may change
          with at least 30 days&apos; notice by email.
        </li>
        <li>Card subscriptions are processed by Stripe and renew automatically each month until cancelled. bKash payments cover one month each and do not renew automatically.</li>
        <li>If a payment is not made, access to the app is paused after a short grace period. Your data is kept and you can still download it.</li>
        <li>Prices exclude any taxes that may apply where you live. Refunds are covered by our <Link href="/refund">Refund Policy</Link>.</li>
      </ul>

      <h2>3. Your data</h2>
      <p>
        You own the business data you put into BizFlow (customers, quotations, invoices, payments and notes). We only use it to provide the Service, as described in our{" "}
        <Link href="/privacy">Privacy Policy</Link>. You can export it at any time and delete your account from the Billing page.
      </p>

      <h2>4. Acceptable use</h2>
      <p>Do not use the Service to break the law, send fraudulent invoices, infringe others&apos; rights, attempt to access other accounts, or disrupt or overload the Service.</p>

      <h2>5. Availability and changes</h2>
      <p>
        We work to keep the Service available and your data safe, but we cannot guarantee uninterrupted service. We may improve or change features; we will tell you in
        advance about changes that materially reduce what the Service does.
      </p>

      <h2>6. Ending the agreement</h2>
      <p>
        You can stop using the Service and delete your account at any time. We may suspend or close accounts that break these terms, after notice where reasonable. On
        deletion, your business data is permanently removed from our live systems.
      </p>

      <h2>7. Liability</h2>
      <p>
        The Service is provided &quot;as is&quot;. To the extent permitted by law, we are not liable for indirect or consequential losses, and our total liability is limited to the
        amount you paid us in the 12 months before the claim. You remain responsible for the accuracy of your own invoices and tax filings.
      </p>

      <h2>8. Law and contact</h2>
      <p>
        These terms are governed by the laws of Bangladesh, unless the law where you live requires otherwise. Questions: <a href={`mailto:${email}`}>{email}</a>.
      </p>
    </LegalPage>
  );
}

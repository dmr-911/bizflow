import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/legal-page";
import { trialDays } from "@/lib/services/billing";
import { site } from "@/lib/site";

export const metadata: Metadata = { title: "Refund Policy", alternates: { canonical: "/refund" } };

export default function RefundPage() {
  const email = site.supportEmail;
  return (
    <LegalPage title="Refund Policy">
      <p>We want you to pay only for a Service you find useful. That is why every account starts with a free {trialDays()}-day trial, with no payment details required.</p>

      <h2>Cancelling</h2>
      <ul>
        <li>Card subscriptions can be cancelled at any time from the Billing page. You keep access until the end of the month you have paid for, and you will not be charged again.</li>
        <li>bKash payments cover one month each and never renew automatically, so there is nothing to cancel.</li>
      </ul>

      <h2>Refunds</h2>
      <ul>
        <li>If you were charged by mistake (for example a duplicate payment, or a renewal right after you tried to cancel), email us within 14 days and we will refund it in full.</li>
        <li>If the Service was unavailable for a significant part of a paid month, we will refund or credit that month on request.</li>
        <li>Otherwise, monthly payments are not refundable once the month has started.</li>
      </ul>

      <h2>How refunds are paid</h2>
      <p>
        Refunds go back to the original payment method: card refunds through Stripe usually appear within 5–10 business days, and bKash refunds are returned to the bKash
        account that paid, normally within 7 business days.
      </p>

      <h2>Contact</h2>
      <p>
        Email <a href={`mailto:${email}`}>{email}</a> with your account email and the payment reference (Stripe receipt or bKash transaction ID) shown on your Billing page.
      </p>
    </LegalPage>
  );
}

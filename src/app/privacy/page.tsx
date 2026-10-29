import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/legal-page";
import { site } from "@/lib/site";

export const metadata: Metadata = { title: "Privacy Policy", alternates: { canonical: "/privacy" } };

export default function PrivacyPage() {
  const email = site.supportEmail;
  return (
    <LegalPage title="Privacy Policy">
      <p>
        This policy explains what {site.company} collects when you use BizFlow, why, and the choices you have. We do not sell your data or use it for advertising.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li><strong>Account details:</strong> your name, business name, email address and a securely hashed password (we never store the password itself).</li>
        <li><strong>Business data you enter:</strong> customers, quotations, invoices, payments, follow-ups and settings. Each business is stored in its own separate database.</li>
        <li><strong>Billing records:</strong> your plan, payment dates, amounts and payment references. Card numbers are handled by Stripe and bKash PINs by bKash; they never reach our servers.</li>
        <li><strong>Technical data:</strong> IP address and browser information in server logs, used for security and troubleshooting, and essential cookies (below).</li>
      </ul>

      <h2>How we use it</h2>
      <ul>
        <li>To run the Service: sign you in, store and show your records, and produce your documents.</li>
        <li>To process subscription payments and send account emails such as password resets and billing notices.</li>
        <li>To protect the Service against abuse, such as limiting repeated sign-in attempts.</li>
      </ul>

      <h2>Who we share it with</h2>
      <ul>
        <li><strong>Stripe</strong> (card payments) and <strong>bKash</strong> (mobile payments), only the details needed to take a payment.</li>
        <li>Our hosting and email providers, who process data on our behalf under confidentiality obligations.</li>
        <li>Authorities, only where the law requires it.</li>
      </ul>

      <h2>Cookies</h2>
      <p>
        We use one cookie to keep you signed in and one to remember your language. Both are essential to the Service. We do not use advertising or tracking cookies.
      </p>

      <h2>Retention and deletion</h2>
      <p>
        We keep your data while your account exists. When you delete your account from the Billing page, your business database and login are removed immediately from our
        live systems; backups are overwritten within 30 days. We may keep billing records longer where accounting law requires it.
      </p>

      <h2>Your rights</h2>
      <p>
        You can view, correct and export your data in the app at any time. To ask about or exercise any other right, email <a href={`mailto:${email}`}>{email}</a>.
      </p>

      <h2>Security</h2>
      <p>Connections are encrypted with HTTPS, passwords are hashed with scrypt, and every business&apos;s records are kept in a separate database.</p>

      <h2>Changes</h2>
      <p>We will post any changes here and email you about significant ones.</p>
    </LegalPage>
  );
}

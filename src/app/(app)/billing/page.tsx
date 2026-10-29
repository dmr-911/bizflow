import type { Metadata } from "next";
import { openStripePortalAction, startBkashPaymentAction, startStripeCheckoutAction } from "@/app/actions/billing";
import { DeleteAccountForm } from "@/components/delete-account-form";
import { Icon } from "@/components/icons";
import { Alert, Badge, Button, Card, PageHeader, Table, Td, Th } from "@/components/ui";
import { getDb } from "@/lib/db";
import { bkashConfig } from "@/lib/billing/bkash";
import { stripeClient } from "@/lib/billing/stripe";
import { applySubscription } from "@/lib/billing/stripe-events";
import { interpolate, type Dictionary } from "@/lib/i18n";
import { accessState, getSubscription, listBillingPayments, PLAN, setStripeCustomer, type AccessState, type Subscription } from "@/lib/services/billing";
import { accountContext } from "@/lib/server/context";
import { site } from "@/lib/site";

export const metadata: Metadata = { title: "Billing" };

type Search = { checkout?: string; session_id?: string; bkash?: string; error?: string };

/** Confirm a finished Checkout right away instead of waiting for the webhook. */
async function syncCheckout(accountId: number, sessionId: string): Promise<boolean> {
  const stripe = stripeClient();
  if (!stripe) return false;
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["subscription"] });
    if (session.client_reference_id !== String(accountId) || session.status !== "complete") return false;
    const db = await getDb();
    if (typeof session.customer === "string") await setStripeCustomer(db, accountId, session.customer);
    if (session.subscription && typeof session.subscription !== "string") await applySubscription(db, session.subscription, accountId);
    return true;
  } catch (e) {
    console.error("Could not confirm Stripe checkout", sessionId, e);
    return false;
  }
}

function notice(sp: Search, t: Dictionary["billing"], confirmed: boolean): { tone: "success" | "error" | "info" | "warning"; text: string } | null {
  if (sp.checkout === "success") return confirmed ? { tone: "success", text: t.checkoutSuccess } : { tone: "info", text: t.checkoutPending };
  if (sp.checkout === "cancelled") return { tone: "info", text: t.checkoutCancelled };
  if (sp.bkash === "success") return { tone: "success", text: t.bkashSuccess };
  if (sp.bkash === "cancelled") return { tone: "info", text: t.bkashCancelled };
  if (sp.bkash === "failed") return { tone: "error", text: t.bkashFailed };
  if (sp.bkash === "pending") return { tone: "warning", text: t.bkashPending };
  const errors: Record<string, string> = {
    stripe_unavailable: t.stripeUnavailable,
    bkash_unavailable: t.bkashUnavailable,
    already_subscribed: t.alreadySubscribed,
    bkash_failed: t.paymentStartFailed,
    too_many: t.paymentStartFailed,
  };
  return sp.error && errors[sp.error] ? { tone: "error", text: errors[sp.error] } : null;
}

function statusLine(sub: Subscription, access: AccessState, t: Dictionary["billing"], date: (iso: string | null) => string) {
  const d = date(access.endsAt);
  switch (access.state) {
    case "trial":
      return interpolate(t.trialText, { days: access.daysLeft, date: d });
    case "trial_ended":
      return t.trialEndedText;
    case "grace":
      return interpolate(t.graceText, { date: d });
    case "expired":
      return interpolate(t.expiredText, { date: d });
    case "active":
      if (sub.provider === "stripe" && sub.status !== "canceled") {
        return sub.cancelAtPeriodEnd ? interpolate(t.cancelsText, { date: d }) : interpolate(t.renewsText, { date: d });
      }
      return sub.provider === "bkash" ? interpolate(t.bkashRenewText, { date: d }) : interpolate(t.activeText, { date: d });
  }
}

export default async function BillingPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { user, t, fmt } = await accountContext();
  const sp = await searchParams;
  const confirmed = sp.checkout === "success" && sp.session_id ? await syncCheckout(user.accountId, sp.session_id) : false;
  const db = await getDb();
  // Read after a possible sync so the page shows the new state.
  const [sub, payments] = await Promise.all([getSubscription(db, user.accountId), listBillingPayments(db, user.accountId)]);
  const access = accessState(sub);
  const b = t.billing;
  const msg = notice(sp, b, confirmed);
  const stripeOn = !!stripeClient();
  const bkashOn = !!bkashConfig();
  const autoRenewing = sub.provider === "stripe" && !!sub.stripeSubscriptionId && sub.status !== "canceled";
  const bdt = fmt.number(PLAN.bdtPoisha / 100);

  const badge = {
    trial: <Badge tone="blue">{b.statusTrial}</Badge>,
    active: <Badge tone="green">{b.statusActive}</Badge>,
    grace: <Badge tone="amber">{b.statusGrace}</Badge>,
    trial_ended: <Badge tone="red">{b.statusEnded}</Badge>,
    expired: <Badge tone="red">{b.statusEnded}</Badge>,
  }[access.state];

  return (
    <>
      <PageHeader title={b.title} subtitle={b.subtitle} />
      <div className="space-y-6">
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}

        <Card>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-slate-900">{b.plan}</h2>
                {badge}
              </div>
              <p className="mt-1 text-sm text-slate-600">{statusLine(sub, access, b, fmt.date)}</p>
              <p className="mt-1 text-xs text-slate-500">{b.planIncludes}</p>
            </div>
            {sub.stripeCustomerId && stripeOn && (
              <form action={openStripePortalAction}>
                <Button variant="secondary" type="submit">
                  {b.manageButton}
                </Button>
              </form>
            )}
          </div>
        </Card>

        {!autoRenewing && (
          <section aria-labelledby="pay-heading">
            <h2 id="pay-heading" className="mb-3 text-sm font-semibold text-slate-800">
              {b.choose}
            </h2>
            <div className="grid gap-4 md:grid-cols-2">
              <PayOption
                title={b.payCard}
                price={b.payCardPrice}
                help={b.payCardHelp}
                action={startStripeCheckoutAction}
                button={b.payCardButton}
                available={stripeOn}
                unavailable={b.stripeUnavailable}
                badge={<span className="text-xs font-medium text-slate-500">Visa · Mastercard · Amex</span>}
              />
              <PayOption
                title={b.payBkash}
                price={interpolate(b.payBkashPrice, { bdt })}
                help={b.payBkashHelp}
                action={startBkashPaymentAction}
                button={interpolate(b.payBkashButton, { bdt })}
                available={bkashOn}
                unavailable={b.bkashUnavailable}
                accent
                badge={<span className="rounded bg-[#e2136e] px-1.5 py-0.5 text-[11px] font-bold text-white">bKash</span>}
              />
            </div>
            {access.state === "trial" && <p className="mt-3 text-xs text-slate-500">{b.trialKept}</p>}
          </section>
        )}

        <Card title={b.history} padded={false}>
          {payments.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-500">{b.noPayments}</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{b.colDate}</Th>
                  <Th>{b.colMethod}</Th>
                  <Th>{b.colPeriod}</Th>
                  <Th>{b.colRef}</Th>
                  <Th className="text-right">{b.colAmount}</Th>
                  <Th>{b.colStatus}</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {payments.map((p) => (
                  <tr key={p.id}>
                    <Td className="whitespace-nowrap">{fmt.date(p.createdAt.slice(0, 10))}</Td>
                    <Td>{p.provider === "bkash" ? b.bkash : b.card}</Td>
                    <Td className="whitespace-nowrap">
                      {p.periodStart && p.periodEnd ? `${fmt.date(p.periodStart.slice(0, 10))} – ${fmt.date(p.periodEnd.slice(0, 10))}` : "—"}
                    </Td>
                    <Td className="font-mono text-xs">{p.trxId || p.reference}</Td>
                    <Td className="tabular whitespace-nowrap text-right">{fmt.money(p.amount, p.currency === "BDT" ? "BDT" : "USD")}</Td>
                    <Td>
                      <Badge tone={p.status === "paid" ? "green" : p.status === "failed" ? "red" : "gray"}>
                        {p.status === "paid" ? b.paid : p.status === "failed" ? b.failed : b.cancelled}
                      </Badge>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card title={b.dataTitle}>
            <p className="mb-4 text-sm text-slate-600">{b.dataText}</p>
            <div className="flex flex-wrap gap-2">
              <a href="/api/backup" className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700">
                <Icon name="download" className="size-4" />
                {t.settings.downloadBackup}
              </a>
              {(["customers", "invoices", "quotations", "payments"] as const).map((k) => (
                <a key={k} href={`/api/export/${k}`} className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50">
                  CSV: {k === "payments" ? t.payments.title : t.nav[k]}
                </a>
              ))}
            </div>
          </Card>
          <Card title={b.account}>
            <p className="mb-4 text-sm text-slate-600">{interpolate(b.signedInAs, { email: user.email })}</p>
            <DeleteAccountForm />
          </Card>
        </div>
        <p className="text-center text-xs text-slate-500">{interpolate(b.support, { email: site.supportEmail })}</p>
      </div>
    </>
  );
}

function PayOption(p: {
  title: string;
  price: string;
  help: string;
  action: () => Promise<void>;
  button: string;
  available: boolean;
  unavailable: string;
  badge: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <form action={p.action} className="flex flex-col rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">{p.title}</h3>
        {p.badge}
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{p.price}</p>
      <p className="mt-2 flex-1 text-sm text-slate-600">{p.help}</p>
      <Button type="submit" disabled={!p.available} className={p.accent ? "mt-4 w-full bg-[#e2136e]! hover:bg-[#c10f5e]!" : "mt-4 w-full"}>
        {p.button}
      </Button>
      {!p.available && <p className="mt-2 text-xs text-slate-500">{p.unavailable}</p>}
    </form>
  );
}

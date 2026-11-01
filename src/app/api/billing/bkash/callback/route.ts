import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { bkashConfig, executePayment, queryPayment, type BkashPaymentResult } from "@/lib/billing/bkash";
import { completeBkashPayment, failBkashPayment, pendingBkashPayment } from "@/lib/services/billing";
import { routeUser } from "@/lib/server/route-auth";

export const dynamic = "force-dynamic";

/** bKash sends the customer back here with ?paymentID=...&status=success|failure|cancel. */
export async function GET(req: NextRequest) {
  const back = (result: string) => NextResponse.redirect(new URL(`/billing?bkash=${result}`, process.env.APP_URL || req.url));
  const paymentId = req.nextUrl.searchParams.get("paymentID") ?? "";
  const status = req.nextUrl.searchParams.get("status");
  const db = await getDb();
  const pending = paymentId ? await pendingBkashPayment(db, paymentId) : null;
  if (!pending) return back("failed");

  // If someone is signed in, it must be the account that started the payment.
  const user = await routeUser();
  if (user && user.accountId !== pending.accountId) return back("failed");
  if (pending.status === "paid") return back("success");
  if (pending.status !== "pending") return back("failed");

  if (status !== "success") {
    await failBkashPayment(db, paymentId, status === "cancel" ? "cancelled" : "failed");
    return back(status === "cancel" ? "cancelled" : "failed");
  }

  const cfg = bkashConfig();
  if (!cfg) return back("failed");
  let result: BkashPaymentResult;
  try {
    result = await executePayment(cfg, paymentId);
  } catch (e) {
    // Execute can time out or report "already completed"; the status query is authoritative.
    console.warn("bKash execute failed, querying status", paymentId, e);
    try {
      result = await queryPayment(cfg, paymentId);
    } catch (e2) {
      console.error("bKash status query failed", paymentId, e2);
      return back("pending");
    }
  }

  if (result.completed && result.amount >= pending.amount) {
    await completeBkashPayment(db, paymentId, result.trxId);
    return back("success");
  }
  await failBkashPayment(db, paymentId, "failed");
  return back("failed");
}

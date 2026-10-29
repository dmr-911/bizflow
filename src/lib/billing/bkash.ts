import "server-only";

/**
 * Minimal client for the bKash Tokenized Checkout API (v1.2.0-beta).
 * Flow: grant token -> create payment -> customer approves on bKash -> callback -> execute.
 * Sandbox and live use the same code; only BKASH_BASE_URL and the four credentials change.
 */

export interface BkashConfig {
  baseUrl: string;
  appKey: string;
  appSecret: string;
  username: string;
  password: string;
}

export const BKASH_SANDBOX_URL = "https://tokenized.sandbox.bka.sh/v1.2.0-beta";

export function bkashConfig(): BkashConfig | null {
  const { BKASH_APP_KEY, BKASH_APP_SECRET, BKASH_USERNAME, BKASH_PASSWORD } = process.env;
  if (!BKASH_APP_KEY || !BKASH_APP_SECRET || !BKASH_USERNAME || !BKASH_PASSWORD) return null;
  return {
    baseUrl: (process.env.BKASH_BASE_URL || BKASH_SANDBOX_URL).replace(/\/+$/, ""),
    appKey: BKASH_APP_KEY,
    appSecret: BKASH_APP_SECRET,
    username: BKASH_USERNAME,
    password: BKASH_PASSWORD,
  };
}

export class BkashError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "BkashError";
  }
}

type Json = Record<string, unknown>;

// id_token is valid for one hour; refresh a little early.
let cachedToken: { key: string; token: string; expiresAt: number } | null = null;

async function post(cfg: BkashConfig, path: string, body: Json, headers: Record<string, string>): Promise<Json> {
  const res = await fetch(`${cfg.baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await res.json().catch(() => ({}))) as Json;
  if (!res.ok) throw new BkashError(String(data.statusMessage ?? data.message ?? `bKash HTTP ${res.status}`), String(data.statusCode ?? res.status));
  // bKash reports most errors with HTTP 200 and a non-0000 statusCode (or errorCode on older endpoints).
  const code = (data.statusCode ?? data.errorCode) as string | undefined;
  if (code && code !== "0000") throw new BkashError(String(data.statusMessage ?? data.errorMessage ?? "bKash request failed"), code);
  return data;
}

async function token(cfg: BkashConfig): Promise<string> {
  const key = `${cfg.baseUrl}|${cfg.appKey}`;
  if (cachedToken && cachedToken.key === key && cachedToken.expiresAt > Date.now()) return cachedToken.token;
  const data = await post(
    cfg,
    "/tokenized/checkout/token/grant",
    { app_key: cfg.appKey, app_secret: cfg.appSecret },
    { username: cfg.username, password: cfg.password },
  );
  const idToken = String(data.id_token ?? "");
  if (!idToken) throw new BkashError("bKash did not return a token");
  const ttl = Number(data.expires_in) || 3600;
  cachedToken = { key, token: idToken, expiresAt: Date.now() + (ttl - 300) * 1000 };
  return idToken;
}

const authHeaders = async (cfg: BkashConfig) => ({ Authorization: await token(cfg), "X-APP-Key": cfg.appKey });

/** Amount is in poisha; bKash expects a decimal string in taka. */
export async function createPayment(
  cfg: BkashConfig,
  p: { amount: number; invoiceNumber: string; payerReference: string; callbackURL: string },
): Promise<{ paymentId: string; bkashURL: string }> {
  const data = await post(
    cfg,
    "/tokenized/checkout/create",
    {
      mode: "0011", // checkout without saving an agreement
      payerReference: p.payerReference,
      callbackURL: p.callbackURL,
      amount: (p.amount / 100).toFixed(2),
      currency: "BDT",
      intent: "sale",
      merchantInvoiceNumber: p.invoiceNumber,
    },
    await authHeaders(cfg),
  );
  const paymentId = String(data.paymentID ?? "");
  const bkashURL = String(data.bkashURL ?? "");
  if (!paymentId || !bkashURL) throw new BkashError("bKash did not return a payment URL");
  return { paymentId, bkashURL };
}

export interface BkashPaymentResult {
  completed: boolean;
  trxId: string;
  /** Poisha. */
  amount: number;
  status: string;
}

function toResult(data: Json): BkashPaymentResult {
  const status = String(data.transactionStatus ?? "");
  return {
    completed: status === "Completed",
    trxId: String(data.trxID ?? ""),
    amount: Math.round(Number(data.amount ?? 0) * 100),
    status,
  };
}

export async function executePayment(cfg: BkashConfig, paymentId: string): Promise<BkashPaymentResult> {
  return toResult(await post(cfg, "/tokenized/checkout/execute", { paymentID: paymentId }, await authHeaders(cfg)));
}

/** Used when execute times out or reports the payment was already processed. */
export async function queryPayment(cfg: BkashConfig, paymentId: string): Promise<BkashPaymentResult> {
  return toResult(await post(cfg, "/tokenized/checkout/payment/status", { paymentID: paymentId }, await authHeaders(cfg)));
}

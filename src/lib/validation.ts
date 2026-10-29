import { z } from "zod";
import { CURRENCIES, parseMoney, parseScaled } from "./money";
import { DATE_FORMATS, isValidIsoDate } from "./dates";
import { QTY_SCALE } from "./calc";

const trimmed = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => trimmed(max).optional().default("");

export const isoDate = z.string().refine(isValidIsoDate, { message: "Enter a valid date" });
const optionalIsoDate = z
  .string()
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || isValidIsoDate(v), { message: "Enter a valid date" });

/** Decimal string -> minor units. */
export const moneyString = z
  .union([z.string(), z.number()])
  .transform((v, ctx) => {
    const parsed = parseMoney(String(v));
    if (parsed === null) {
      ctx.addIssue({ code: "custom", message: "Enter a valid amount (max 2 decimals)" });
      return z.NEVER;
    }
    return parsed;
  });

const positiveMoneyString = moneyString.refine((v) => v > 0, { message: "Amount must be greater than zero" });

const quantityString = z.union([z.string(), z.number()]).transform((v, ctx) => {
  const parsed = parseScaled(String(v), 3);
  if (parsed === null || parsed <= 0 || parsed > 1_000_000 * QTY_SCALE) {
    ctx.addIssue({ code: "custom", message: "Enter a quantity greater than zero (max 3 decimals)" });
    return z.NEVER;
  }
  return parsed;
});

/** Percentage string -> basis points (0..10000). */
export const percentString = z.union([z.string(), z.number()]).transform((v, ctx) => {
  const s = String(v).trim() === "" ? "0" : String(v);
  const parsed = parseScaled(s, 2);
  if (parsed === null || parsed > 10_000) {
    ctx.addIssue({ code: "custom", message: "Enter a percentage between 0 and 100" });
    return z.NEVER;
  }
  return parsed;
});

// ---------- Customers ----------

export const customerSchema = z.object({
  name: trimmed(120).min(1, "Name is required"),
  company: optionalText(160),
  email: z
    .string()
    .trim()
    .max(160)
    .optional()
    .default("")
    .refine((v) => v === "" || z.email().safeParse(v).success, { message: "Enter a valid email" }),
  phone: optionalText(40),
  address: optionalText(400),
  city: optionalText(80),
  country: optionalText(80),
  taxId: optionalText(60),
  notes: optionalText(4000),
});
export type CustomerInput = z.infer<typeof customerSchema>;
export type CustomerFormValues = z.input<typeof customerSchema>;

// ---------- Quotations & invoices ----------

export const lineItemSchema = z
  .object({
    description: trimmed(500).min(1, "Description is required"),
    quantity: quantityString,
    unitPrice: moneyString,
    discountType: z.enum(["percent", "amount"]).default("percent"),
    discountValue: z.union([z.string(), z.number()]).optional().default("0"),
    taxRateId: z.string().optional().default(""),
  })
  .transform((line, ctx) => {
    let discountValue: number | null;
    if (line.discountType === "percent") {
      const r = percentString.safeParse(line.discountValue);
      discountValue = r.success ? r.data : null;
    } else {
      const raw = String(line.discountValue).trim() === "" ? "0" : String(line.discountValue);
      discountValue = parseMoney(raw);
    }
    if (discountValue === null) {
      ctx.addIssue({ code: "custom", path: ["discountValue"], message: "Enter a valid discount" });
      return z.NEVER;
    }
    return { ...line, discountValue };
  });

export const documentSchema = z
  .object({
    customerId: z.coerce.number().int().positive("Choose a customer"),
    issueDate: isoDate,
    dueDate: optionalIsoDate,
    currency: z.enum(CURRENCIES),
    notes: optionalText(4000),
    terms: optionalText(4000),
    items: z.array(lineItemSchema).min(1, "Add at least one line item").max(200),
  })
  .refine((d) => !d.dueDate || d.dueDate >= d.issueDate, {
    path: ["dueDate"],
    message: "Due date cannot be before the issue date",
  });
export type DocumentInput = z.output<typeof documentSchema>;
export type DocumentFormValues = z.input<typeof documentSchema>;

// ---------- Payments ----------

export const PAYMENT_METHODS = ["cash", "bank", "bkash", "nagad", "card", "cheque", "other"] as const;

export const paymentSchema = z.object({
  amount: positiveMoneyString,
  paidAt: isoDate,
  method: z.enum(PAYMENT_METHODS),
  reference: optionalText(120),
  note: optionalText(500),
});
export type PaymentInput = z.output<typeof paymentSchema>;

// ---------- Follow-ups ----------

export const followUpSchema = z.object({
  title: trimmed(200).min(1, "Title is required"),
  dueDate: isoDate,
  customerId: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v === undefined || v === "" ? null : Number(v)))
    .refine((v) => v === null || (Number.isInteger(v) && v > 0), { message: "Invalid customer" }),
  documentId: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v === undefined || v === "" ? null : Number(v)))
    .refine((v) => v === null || (Number.isInteger(v) && v > 0), { message: "Invalid document" }),
  note: optionalText(2000),
});
export type FollowUpInput = z.output<typeof followUpSchema>;

// ---------- Settings ----------

const numberingSchema = z.object({
  prefix: z.string().trim().max(12).regex(/^[A-Za-z0-9\-_/#]*$/, "Use letters, digits, - _ / # only"),
  padding: z.coerce.number().int().min(1).max(10),
  next: z.coerce.number().int().min(1).max(999_999_999),
  includeYear: z.boolean(),
});

export const taxRateSchema = z.object({
  id: z.string().min(1).max(40),
  name: trimmed(40).min(1, "Tax name is required"),
  rateBps: z.number().int().min(0).max(10_000),
  isDefault: z.boolean(),
});
export type TaxRate = z.infer<typeof taxRateSchema>;

export const settingsSchema = z.object({
  business: z.object({
    name: trimmed(120).min(1, "Business name is required"),
    email: optionalText(160),
    phone: optionalText(40),
    address: optionalText(400),
    website: optionalText(160),
    taxId: optionalText(60),
  }),
  locale: z.enum(["en", "bn"]),
  defaultCurrency: z.enum(CURRENCIES),
  dateFormat: z.enum(DATE_FORMATS),
  invoiceNumbering: numberingSchema,
  quotationNumbering: numberingSchema,
  paymentTermsDays: z.coerce.number().int().min(0).max(365),
  quotationValidityDays: z.coerce.number().int().min(0).max(365),
  taxLabel: trimmed(20).min(1),
  taxRates: z.array(taxRateSchema).max(20),
  invoiceTerms: optionalText(2000),
  quotationTerms: optionalText(2000),
  documentFooter: optionalText(500),
});
export type Settings = z.infer<typeof settingsSchema>;

export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(200, "Password is too long");

/** Messages come from the visitor's dictionary so signup errors read in their language. */
export interface AuthMessages {
  nameRequired: string;
  businessRequired: string;
  emailInvalid: string;
  passwordShort: string;
  passwordLong: string;
  termsRequired: string;
}

const email = (m: AuthMessages) => z.string().trim().toLowerCase().max(254, m.emailInvalid).pipe(z.email({ message: m.emailInvalid }));
const newPassword = (m: AuthMessages) => z.string().min(10, m.passwordShort).max(200, m.passwordLong);

export const signupSchema = (m: AuthMessages) =>
  z.object({
    name: z.string().trim().min(2, m.nameRequired).max(80, m.nameRequired),
    businessName: z.string().trim().min(2, m.businessRequired).max(120, m.businessRequired),
    email: email(m),
    password: newPassword(m),
    terms: z.literal("on", { message: m.termsRequired }),
  });

export const emailSchema = (m: AuthMessages) => email(m);
export const newPasswordSchema = (m: AuthMessages) => newPassword(m);

/** Flatten zod issues into { "items.0.quantity": "message" } for forms. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

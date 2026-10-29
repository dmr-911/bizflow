import "server-only";
import nodemailer, { type Transporter } from "nodemailer";

let transport: Transporter | null = null;

/**
 * Sends through SMTP_URL (any provider: Amazon SES, Postmark, Resend, Mailgun, Gmail...).
 * Without it, emails are printed to the server log so local development works.
 */
export async function sendMail(msg: { to: string; subject: string; text: string }): Promise<void> {
  const url = process.env.SMTP_URL;
  const from = process.env.MAIL_FROM || "BizFlow <no-reply@localhost>";
  if (!url) {
    if (process.env.NODE_ENV === "production") console.warn("SMTP_URL is not set; email not sent:", msg.subject, "to", msg.to);
    else console.info(`\n--- email to ${msg.to} ---\nSubject: ${msg.subject}\n\n${msg.text}\n---\n`);
    return;
  }
  transport ??= nodemailer.createTransport(url);
  await transport.sendMail({ from, ...msg });
}

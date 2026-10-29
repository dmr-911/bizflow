import type { Metadata, Viewport } from "next";
import { getDb } from "@/lib/db";
import { getSettings } from "@/lib/services/settings";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "BizFlow Kit", template: "%s · BizFlow Kit" },
  description: "Customers, quotations, invoices and follow-ups for small businesses.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#1f57d6" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = getSettings(getDb()).locale;
  return (
    <html lang={locale}>
      <body>{children}</body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";
import { requestLocale } from "@/lib/server/context";
import { site } from "@/lib/site";
import "./globals.css";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  return {
    metadataBase: new URL(site.url),
    title: { default: "BizFlow: invoices, quotations and follow-ups for small businesses", template: "%s · BizFlow" },
    description:
      "Send quotations, turn them into invoices, track payments and never miss a follow-up. In English and Bangla, BDT and USD. US$5/month, free trial.",
    applicationName: "BizFlow",
    openGraph: {
      type: "website",
      siteName: "BizFlow",
      images: [{ url: "/screens/dashboard.png", width: 1360, height: 1100, alt: "BizFlow dashboard" }],
    },
    twitter: { card: "summary_large_image" },
  };
}

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#1f57d6" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await requestLocale();
  return (
    <html lang={locale} className="scroll-smooth">
      <body>{children}</body>
    </html>
  );
}

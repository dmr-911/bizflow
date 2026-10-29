import type { MetadataRoute } from "next";
import { site } from "@/lib/site";

export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/signup", "/login", "/terms", "/privacy", "/refund"],
        disallow: ["/dashboard", "/customers", "/quotations", "/invoices", "/follow-ups", "/reports", "/settings", "/billing", "/print", "/api/", "/reset-password", "/forgot-password"],
      },
    ],
    sitemap: `${site.url}/sitemap.xml`,
  };
}

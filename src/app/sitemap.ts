import type { MetadataRoute } from "next";
import { site } from "@/lib/site";

export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  const pages: [string, number][] = [["/", 1], ["/signup", 0.8], ["/login", 0.5], ["/terms", 0.3], ["/privacy", 0.3], ["/refund", 0.3]];
  return pages.map(([path, priority]) => ({ url: `${site.url}${path}`, changeFrequency: "monthly", priority }));
}

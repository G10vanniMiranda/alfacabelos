import type { MetadataRoute } from "next";

// Read the public host at request time: a Docker image is built once and deployed to several hosts.
export const dynamic = "force-dynamic";

function getSiteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
  if (configured) {
    return configured.replace(/\/$/, "");
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  return "http://localhost:3000";
}

export default function robots(): MetadataRoute.Robots {
  const siteUrl = getSiteUrl();

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/api", "/cliente"],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}

import { siteConfig } from "../../config/site";
export const absoluteUrl = (path: string) => new URL(path, siteConfig.url).href;
export const jsonLd = (data: unknown) =>
  JSON.stringify(data).replace(/</g, "\\u003c");
export const organization = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": `${siteConfig.url}/#organization`,
  name: siteConfig.name,
  url: siteConfig.url,
  description: siteConfig.description,
  sameAs: [siteConfig.instagramUrl],
  address: {
    "@type": "PostalAddress",
    addressLocality: siteConfig.town,
    addressRegion: siteConfig.region,
    addressCountry: siteConfig.country,
  },
  ...(siteConfig.contactEmail ? { email: siteConfig.contactEmail } : {}),
};

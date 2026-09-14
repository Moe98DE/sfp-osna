import { existsSync } from "node:fs";
// Astro config is evaluated before Vite's .env loading. Node's loader preserves
// values already supplied by CI and keeps local build/deploy origins consistent.
if (existsSync(".env")) process.loadEnvFile(".env");
const configuredUrl = process.env.SITE_URL || "https://example.org";
const url = new URL(configuredUrl);
if (
  !/^https?:$/.test(url.protocol) ||
  url.username ||
  url.password ||
  url.pathname !== "/" ||
  url.search ||
  url.hash
) {
  throw new Error(
    "SITE_URL must be an http(s) origin, without credentials or a subpath.",
  );
}

export const siteConfig = {
  name: "Students for Palestine Osnabrück",
  shortName: "SFP Osna",
  description:
    "Für ein freies Palästina. Palästina-solidarische Studis in Osnabrück: Buchclub, Film, Austausch und gemeinsame Solidarität.",
  introduction:
    "Wir sind palästina-solidarische Studis in Osnabrück. Wir lesen, schauen hin und kommen zusammen – für ein freies Palästina.",
  statement: "Für ein freies Palästina.",
  activities: [
    {
      number: "01",
      title: "Zusammen lesen.",
      label: "Buchclub",
      text: "Palästinensische Literatur und Perspektiven. Unser Buchclub gibt Texten Raum – und den Fragen, die sie aufwerfen.",
    },
    {
      number: "02",
      title: "Genauer hinsehen.",
      label: "Film & Gespräch",
      text: "Gemeinsam Filme schauen und darüber sprechen. Geschichten kennenlernen, Perspektiven teilen und miteinander ins Gespräch kommen.",
    },
    {
      number: "03",
      title: "In Verbindung bleiben.",
      label: "Solidarität & Austausch",
      text: "Beim Picknick, im Gespräch oder bei einer Veranstaltung: Solidarität lebt auch davon, dass wir uns begegnen.",
    },
  ],
  url: url.origin,
  town: "Osnabrück",
  region: "Niedersachsen",
  country: "DE",
  language: "de",
  locale: "de-DE",
  instagramUrl: "https://www.instagram.com/studentsforpalestine.osna/",
  contactEmail: "sfp.osna@protonmail.com",
  accentColor: "#176e58",
  navigation: [
    { href: "/", label: "Start" },
    { href: "/posts/", label: "Beiträge" },
    { href: "/about/", label: "Über uns" },
    { href: "/contact/", label: "Kontakt" },
  ],
};

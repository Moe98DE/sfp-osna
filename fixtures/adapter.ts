import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  normalizePost,
  type InstagramPost,
} from "../src/lib/instagram/index.js";
import type {
  GeneratedArticle,
  LocalImage,
} from "../src/lib/content/schema.js";

export async function fixturePosts(root: string) {
  return Promise.all(
    ["single-image", "carousel", "review"].map(async (name) =>
      normalizePost(
        JSON.parse(
          await readFile(
            path.join(root, `fixtures/instagram-${name}.json`),
            "utf8",
          ),
        ),
      ),
    ),
  );
}
export async function fixtureImage(url: string): Promise<Buffer> {
  const colors: Record<string, string> = {
    "poster-one.png": "#185641",
    "poster-two.png": "#a72b35",
    "poster-three.png": "#272d2a",
  };
  const color = colors[new URL(url).pathname.slice(1)];
  if (!color) throw new Error("Unknown fixture image");
  // A typographic test poster, intentionally not a fabricated documentary photograph.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900"><rect width="1200" height="900" fill="${color}"/><g fill="#fff" font-family="sans-serif"><text x="90" y="145" font-size="30">SFP OSNA · DEMO</text><text x="90" y="430" font-size="86">Gemeinsam</text><text x="90" y="535" font-size="86">im Gespräch.</text><text x="90" y="790" font-size="26">Beispielmotiv · Kein Veranstaltungsplakat</text></g></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
export function fixtureArticle(
  post: InstagramPost,
  images: LocalImage[],
): string {
  const review = post.id.endsWith("003");
  const carousel = post.mediaType === "CAROUSEL";
  const article: GeneratedArticle = {
    title: review
      ? "Demo: Termin noch zu klären"
      : carousel
        ? "Demo: Gemeinsam lesen und ins Gespräch kommen"
        : "Demo: Unsere Beiträge an einem Ort",
    slug: review
      ? "termin-pruefen"
      : carousel
        ? "gemeinsam-lesen"
        : "beitraege-an-einem-ort",
    summary: carousel
      ? "Ein Beispiel für einen offenen Leseabend: Fragen teilen, Texte besprechen und miteinander ins Gespräch kommen. Termin und Treffpunkt stehen noch nicht fest."
      : "Dieses Beispiel zeigt, wie ein Instagram-Beitrag als eigenständiger, gut lesbarer Artikel auf unserer Website erscheint.",
    body: carousel
      ? "Dies ist ein Demonstrationsbeitrag und keine tatsächliche Veranstaltungsankündigung.\n\n## Gemeinsam lesen\n\nDer Beispieltext kündigt einen offenen Leseabend an. Im Mittelpunkt stehen gemeinsames Lesen, Fragen und das Gespräch miteinander.\n\nEin Datum und ein Treffpunkt sind im Beispiel noch nicht festgelegt. Es gibt deshalb keine verbindliche Einladung zu einem bestimmten Termin.\n\n## Informationen im Original\n\nDie Galerie zeigt zwei Beispielmotive. Bei echten Beiträgen führt der Quellenlink zum zugehörigen Instagram-Original, wo ergänzende Informationen nachgelesen werden können."
      : "Dies ist ein Demonstrationsbeitrag und kein tatsächlich veröffentlichter Instagram-Post.\n\n## Beiträge nachlesen\n\nDie Website sammelt Nachrichten von Students for Palestine Osnabrück. Jeder Artikel bietet einen eigenen Link, einen kurzen Überblick und die zum Beitrag gehörenden Bilder.\n\nDer Link unter dem Artikel führt zum Instagram-Konto. Bei echten importierten Beiträgen führt er direkt zum Originalpost. So bleibt die Quelle einer Nachricht nachvollziehbar.",
    metaDescription: carousel
      ? "Demonstrationsbeitrag: Ein offener Leseabend als Beispiel für einen Artikel mit Bildergalerie. Termin und Treffpunkt sind noch nicht festgelegt."
      : "Demonstrationsbeitrag: So werden die Instagram-Beiträge von Students for Palestine Osnabrück als lesbare Artikel mit lokaler Bildergalerie gesammelt.",
    tags: ["Demo", carousel ? "Austausch" : "Website"],
    imageAltTexts: images.map(
      () =>
        "Beispielmotiv mit der Aufschrift Gemeinsam im Gespräch; ausdrücklich als Demo gekennzeichnet.",
    ),
    needsReview: review,
    warnings: review ? ["Widersprüchlicher Termin; der Ort fehlt."] : [],
  };
  return JSON.stringify(article);
}

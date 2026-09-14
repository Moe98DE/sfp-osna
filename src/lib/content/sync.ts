import { mkdir, readFile, writeFile, open, unlink } from "node:fs/promises";
import path from "node:path";
import {
  articleSlug,
  validateGenerated,
  type GeneratedArticle,
  type LocalImage,
  type ArticleData,
} from "./schema.js";
import { readArticles, writeNewArticle } from "./files.js";
import { optimizeImage } from "./media.js";
import type { InstagramPost } from "../instagram/index.js";
import { SafeError } from "../http.js";
import { deletedArticles } from "./deleted.js";

export async function withSyncLock<T>(
  root: string,
  run: () => Promise<T>,
): Promise<T> {
  const file = path.join(root, ".sync.lock");
  let handle;
  try {
    handle = await open(file, "wx");
  } catch {
    throw new SafeError(
      "Sync is locked. If no sync is running, remove the stale .sync.lock and retry.",
    );
  }
  try {
    await handle.writeFile(String(process.pid));
    return await run();
  } finally {
    await handle.close();
    await unlink(file);
  }
}

export async function importPost(options: {
  root: string;
  post: InstagramPost;
  autoPublish: boolean;
  model: string;
  demo?: boolean;
  loadImage: (url: string) => Promise<Buffer>;
  generate: (images: LocalImage[]) => Promise<string>;
}): Promise<"created" | "draft" | "invalid" | "skipped"> {
  const { root, post } = options;
  // Re-read IDs before any downloads, model calls or writes. Include drafts and nested articles.
  if (
    (await readArticles(root)).some(
      (a) => a.data.instagram.mediaId === post.id,
    ) ||
    (await deletedArticles(root)).some((a) => a.id === post.id)
  )
    return "skipped";
  const images: LocalImage[] = [];
  const warnings = [...post.warnings];
  for (const [index, item] of post.media.entries()) {
    try {
      images.push(
        await optimizeImage(
          root,
          post.id,
          index + 1,
          await options.loadImage(item.url),
        ),
      );
    } catch {
      warnings.push(
        `Image ${index + 1} could not be downloaded or optimized; inspect the original before publishing.`,
      );
    }
  }
  const raw = await options.generate(images);
  let article: GeneratedArticle;
  let invalid = false;
  try {
    article = validateGenerated(JSON.parse(raw), images.length);
  } catch {
    invalid = true;
    article = {
      title: "Instagram-Beitrag zur redaktionellen Prüfung",
      slug: "redaktionelle-pruefung",
      summary:
        "Dieser Beitrag wartet auf eine Prüfung anhand des Instagram-Originals.",
      metaDescription:
        "Dieser Beitrag wartet auf eine redaktionelle Prüfung anhand des Instagram-Originals.",
      body: "Dieser Entwurf konnte nicht sicher aus der Modellantwort erstellt werden. Bitte den Originalbeitrag und die lokale Prüfdatei vergleichen und einen Artikel verfassen.",
      tags: [],
      imageAltTexts: images.map((i) => i.alt),
      needsReview: true,
      warnings: [
        "Gemini response failed local validation; original generated text is retained in review/.",
      ],
    };
  }
  warnings.push(...article.warnings);
  if (!post.caption.trim())
    warnings.push("The source caption is empty; confirm all facts manually.");
  const needsReview = article.needsReview || warnings.length > 0;
  const now = new Date().toISOString();
  const data: ArticleData = {
    title: article.title,
    description: article.metaDescription,
    summary: article.summary,
    publishedAt: post.publishedAt,
    updatedAt: now,
    draft: !options.autoPublish || needsReview,
    demo: options.demo ?? false,
    tags: article.tags,
    images: images.map((img, index) => ({
      ...img,
      alt: article.imageAltTexts[index]!,
    })),
    instagram: {
      mediaId: post.id,
      permalink: post.permalink,
      publishedAt: post.publishedAt,
    },
    generation: {
      generatedAt: now,
      model: options.model,
      needsReview,
      warnings,
    },
  };
  // Preserve source caption and rejected model output outside all public/build inputs.
  const reviewDir = path.join(root, "review");
  await mkdir(reviewDir, { recursive: true });
  await writeFile(
    path.join(reviewDir, `${post.id}.json`),
    JSON.stringify(
      {
        caption: post.caption,
        ...(invalid ? { rejectedModelText: raw } : {}),
      },
      null,
      2,
    ) + "\n",
  );
  const file = path.join(
    root,
    "src/content/posts",
    `${articleSlug(article.slug, post.id)}.md`,
  );
  await writeNewArticle(file, data, article.body);
  return invalid ? "invalid" : data.draft ? "draft" : "created";
}

export async function organizationContext(root: string) {
  return readFile(
    path.join(root, "src/content/organization-context.md"),
    "utf8",
  );
}

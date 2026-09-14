import { z } from "zod";

export const mediaIdSchema = z.string().regex(/^\d{1,40}$/);
export const instagramUrlSchema = z.url().refine((value) => {
  const u = new URL(value);
  return (
    u.protocol === "https:" &&
    ["instagram.com", "www.instagram.com"].includes(u.hostname) &&
    !u.username &&
    !u.password &&
    !u.port
  );
}, "Expected an HTTPS Instagram URL");
export const slugSchema = z
  .string()
  .min(1)
  .max(90)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const plainText = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((s) => !/[<>\u0000-\u0008]/.test(s), "Plain text required");
export const generatedSchema = z.strictObject({
  title: plainText(5, 110),
  slug: slugSchema,
  summary: plainText(20, 350),
  body: z.string().trim().min(30).max(18000),
  metaDescription: plainText(30, 160),
  tags: z.array(plainText(2, 40)).max(8),
  imageAltTexts: z.array(plainText(3, 300)).max(20),
  needsReview: z.boolean(),
  warnings: z.array(plainText(3, 400)).max(20),
});
export type GeneratedArticle = z.infer<typeof generatedSchema>;

export function validateGenerated(
  value: unknown,
  imageCount: number,
): GeneratedArticle {
  const result = generatedSchema.parse(value);
  if (result.imageAltTexts.length !== imageCount)
    throw new Error("Alt text count does not match downloaded images");
  // Generated prose needs no links, images, HTML, code, or embedded components.
  // The template supplies the trusted source link and local gallery separately.
  if (
    /[<>\[\]`]|&(?:#\d+|#x[\da-f]+|lt|gt);|^\s*(?:---|\+\+\+)\s*$/im.test(
      result.body,
    )
  ) {
    throw new Error("Generated Markdown contains disallowed markup");
  }
  if (/^#\s/m.test(result.body))
    throw new Error("Body headings must start at level two");
  return result;
}

export const localImageSchema = z.object({
  src: z.string().regex(/^\/media\/posts\/\d{1,40}\/\d{2}\.webp$/),
  smallSrc: z.string().regex(/^\/media\/posts\/\d{1,40}\/\d{2}-640\.webp$/),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  smallWidth: z.number().int().positive(),
  alt: z.string().min(1).max(300),
});
const isoDate = z.preprocess(
  (value) => (value instanceof Date ? value.toISOString() : value),
  z.iso.datetime(),
);
export const articleSchema = z.object({
  title: z.string().min(1).max(110),
  description: z.string().min(1).max(160),
  summary: z.string().min(1).max(350),
  publishedAt: isoDate,
  updatedAt: isoDate,
  draft: z.boolean(),
  demo: z.boolean().default(false),
  tags: z.array(z.string()),
  images: z.array(localImageSchema),
  instagram: z.object({
    mediaId: mediaIdSchema,
    permalink: instagramUrlSchema,
    publishedAt: isoDate,
  }),
  generation: z.object({
    generatedAt: isoDate,
    model: z.string(),
    needsReview: z.boolean(),
    warnings: z.array(z.string()),
  }),
});
export type ArticleData = z.infer<typeof articleSchema>;
export type LocalImage = z.infer<typeof localImageSchema>;
export function isPublished(data: Pick<ArticleData, "draft" | "generation">) {
  return !data.draft && !data.generation.needsReview;
}
export function articleSlug(slug: string, mediaId: string) {
  return `${slugSchema.parse(slug)}-${mediaIdSchema.parse(mediaId)}`;
}

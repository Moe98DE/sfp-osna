import { z } from "zod";
import { instagramUrlSchema, mediaIdSchema } from "../content/schema.js";
import { request, SafeError } from "../http.js";

const childSchema = z.object({
  id: mediaIdSchema,
  media_type: z.string(),
  media_url: z.url().optional(),
  thumbnail_url: z.url().optional(),
});
export const rawPostSchema = childSchema.extend({
  caption: z.string().max(20000).optional(),
  permalink: instagramUrlSchema,
  timestamp: z.string().refine((v) => Number.isFinite(Date.parse(v))),
  media_product_type: z.string().optional(),
  children: z
    .object({ data: z.array(childSchema), paging: z.unknown().optional() })
    .optional(),
});
export interface InstagramPost {
  id: string;
  permalink: string;
  caption: string;
  publishedAt: string;
  mediaType: "IMAGE" | "CAROUSEL" | "VIDEO" | "REEL" | "UNKNOWN";
  media: { url: string; type: "image" | "video" }[];
  warnings: string[];
}
export function normalizePost(input: unknown): InstagramPost {
  const raw = rawPostSchema.parse(input);
  const warnings: string[] = [];
  const media: InstagramPost["media"] = [];
  const items =
    raw.media_type === "CAROUSEL_ALBUM" ? (raw.children?.data ?? []) : [raw];
  for (const item of items) {
    if (item.media_type === "IMAGE" && item.media_url)
      media.push({ url: item.media_url, type: "image" });
    else if (item.media_type === "VIDEO") {
      if (item.thumbnail_url)
        media.push({ url: item.thumbnail_url, type: "image" });
      warnings.push(
        "Video is linked on Instagram; only its caption and available poster were reviewed.",
      );
    } else warnings.push("A media item has no supported image or poster.");
  }
  if (!media.length) warnings.push("No downloadable images were available.");
  return {
    id: raw.id,
    permalink: raw.permalink,
    caption: raw.caption ?? "",
    publishedAt: new Date(raw.timestamp).toISOString(),
    mediaType:
      raw.media_type === "CAROUSEL_ALBUM"
        ? "CAROUSEL"
        : raw.media_product_type === "REELS"
          ? "REEL"
          : raw.media_type === "IMAGE" || raw.media_type === "VIDEO"
            ? raw.media_type
            : "UNKNOWN",
    media,
    warnings,
  };
}

const pageSchema = z.object({
  data: z.array(z.unknown()),
  paging: z
    .object({
      cursors: z.object({ after: z.string().optional() }).optional(),
      next: z.string().optional(),
    })
    .optional(),
});
export async function* fetchRecentPosts(options: {
  token: string;
  userId: string;
  version: string;
  maxPages: number;
  knownIds: Set<string>;
  newestOnly?: boolean;
}) {
  const userId = mediaIdSchema.parse(options.userId);
  if (!/^v\d+\.0$/.test(options.version))
    throw new SafeError(
      "INSTAGRAM_API_VERSION must be the current supported version, for example v26.0; confirm in Meta's dashboard",
    );
  const getPage = async (path: string, fields: string, after?: string) => {
    const url = new URL(
      `https://graph.instagram.com/${options.version}/${path}`,
    );
    url.searchParams.set("fields", fields);
    url.searchParams.set("limit", "50");
    if (after) url.searchParams.set("after", after);
    const response = await request(
      url,
      { headers: { Authorization: `Bearer ${options.token}` } },
      "Instagram",
    );
    const parsed = pageSchema.safeParse(await response.json());
    if (!parsed.success)
      throw new SafeError(
        "Instagram: malformed media page; check the adapter against the current API fields",
      );
    return parsed.data;
  };
  let after: string | undefined;
  const seenCursors = new Set<string>();
  let newest: z.infer<typeof rawPostSchema> | undefined;
  const hydrate = async (raw: z.infer<typeof rawPostSchema>) => {
    if (raw.media_type === "CAROUSEL_ALBUM") {
      const children: z.infer<typeof childSchema>[] = [];
      const cursors = new Set<string>();
      let childAfter: string | undefined;
      do {
        const childPage = await getPage(
          `${raw.id}/children`,
          "id,media_type,media_url,thumbnail_url",
          childAfter,
        );
        children.push(...z.array(childSchema).parse(childPage.data));
        childAfter = childPage.paging?.next
          ? childPage.paging.cursors?.after
          : undefined;
        if (childPage.paging?.next && (!childAfter || cursors.has(childAfter)))
          throw new SafeError("Instagram: invalid carousel pagination");
        if (childAfter) cursors.add(childAfter);
        if (children.length > 20)
          throw new SafeError("Instagram: unexpected carousel size");
      } while (childAfter);
      raw.children = { data: children };
    }
    return normalizePost(raw);
  };
  for (let pageNumber = 0; pageNumber < options.maxPages; pageNumber++) {
    const page = await getPage(
      `${userId}/media`,
      "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp",
      after,
    );
    for (const item of page.data) {
      const raw = rawPostSchema.safeParse(item);
      if (!raw.success) {
        if (options.newestOnly)
          throw new SafeError(
            "Instagram: malformed metadata prevents identifying the newest post safely.",
          );
        yield {
          error:
            "Instagram: malformed post; required ID, timestamp, permalink or media fields missing",
        };
        continue;
      }
      if (options.newestOnly) {
        if (
          !newest ||
          Date.parse(raw.data.timestamp) > Date.parse(newest.timestamp)
        )
          newest = raw.data;
        continue;
      }
      if (options.knownIds.has(raw.data.id)) continue;
      try {
        yield { post: await hydrate(raw.data) };
        options.knownIds.add(raw.data.id);
      } catch {
        yield {
          error: `Instagram post ${raw.data.id}: could not retrieve media; retry next run`,
        };
      }
    }
    if (!page.paging?.next) break;
    after = page.paging.cursors?.after;
    if (!after || seenCursors.has(after))
      throw new SafeError("Instagram: pagination cursor missing or repeated");
    seenCursors.add(after);
  }
  if (options.newestOnly && newest) {
    if (options.knownIds.has(newest.id))
      console.log(
        "Newest Instagram post already exists or is in trash; nothing to import.",
      );
    else yield { post: await hydrate(newest) };
  }
  console.log(
    Number.isFinite(options.maxPages)
      ? `Fetched up to ${options.maxPages} recent page(s); use --all for a complete backfill.`
      : "Scanned all available Instagram media pages.",
  );
}

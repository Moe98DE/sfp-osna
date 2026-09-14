import { z } from "zod";
import { fetchRecentPosts } from "../src/lib/instagram/index.js";
import { generateArticle } from "../src/lib/gemini/index.js";
import { downloadImage } from "../src/lib/content/media.js";
import { readArticles } from "../src/lib/content/files.js";
import {
  importPost,
  organizationContext,
  withSyncLock,
} from "../src/lib/content/sync.js";
import {
  fixturePosts,
  fixtureImage,
  fixtureArticle,
} from "../fixtures/adapter.js";
import { SafeError } from "../src/lib/http.js";
import { deletedArticles } from "../src/lib/content/deleted.js";

const root = process.cwd();
const args = process.argv.slice(2);
const fixture = args.includes("--fixture");
const newest = args.includes("--newest");
const all = args.includes("--all");
if (
  args.some((arg) => !["--fixture", "--newest", "--all"].includes(arg)) ||
  (newest && all)
) {
  console.error(
    "Usage: npm run sync -- [--fixture] [--newest | --all]. Existing articles are never regenerated.",
  );
  process.exit(1);
}

try {
  await withSyncLock(root, async () => {
    const env = fixture
      ? undefined
      : z
          .object({
            INSTAGRAM_ACCESS_TOKEN: z.string().min(1),
            INSTAGRAM_USER_ID: z.string().regex(/^\d+$/),
            INSTAGRAM_API_VERSION: z.string().regex(/^v\d+\.0$/),
            GEMINI_API_KEY: z.string().min(1),
            GEMINI_MODEL: z.string().min(1).default("gemini-3.8-flash"),
            AUTO_PUBLISH: z.enum(["true", "false"]).default("false"),
            INSTAGRAM_MAX_PAGES: z.coerce
              .number()
              .int()
              .min(1)
              .max(100)
              .default(2),
          })
          .safeParse(process.env);
    if (env && !env.success)
      throw new SafeError(
        `Environment configuration invalid: ${env.error.issues.map((i) => i.path.join(".")).join(", ")}. See .env.example.`,
      );
    const config = env?.data;
    const context = await organizationContext(root);
    const knownIds = new Set([
      ...(await readArticles(root)).map((a) => a.data.instagram.mediaId),
      ...(await deletedArticles(root)).map((a) => a.id),
    ]);
    const fixtures = fixture
      ? (await fixturePosts(root)).sort((a, b) =>
          b.publishedAt.localeCompare(a.publishedAt),
        )
      : [];
    const source = fixture
      ? (newest ? fixtures.slice(0, 1) : fixtures).map((post) => ({ post }))
      : fetchRecentPosts({
          token: config!.INSTAGRAM_ACCESS_TOKEN,
          userId: config!.INSTAGRAM_USER_ID,
          version: config!.INSTAGRAM_API_VERSION,
          maxPages: all || newest ? Infinity : config!.INSTAGRAM_MAX_PAGES,
          newestOnly: newest,
          knownIds,
        });
    const counts = { created: 0, draft: 0, invalid: 0, skipped: 0, failed: 0 };
    for await (const item of source) {
      if ("error" in item) {
        console.error(item.error);
        counts.failed++;
        continue;
      }
      const post = item.post;
      try {
        const result = await importPost({
          root,
          post,
          autoPublish: fixture || config!.AUTO_PUBLISH === "true",
          model: fixture ? "deterministic-fixture-v1" : config!.GEMINI_MODEL,
          demo: fixture,
          loadImage: fixture ? fixtureImage : downloadImage,
          generate: (images) =>
            fixture
              ? Promise.resolve(fixtureArticle(post, images))
              : generateArticle(
                  root,
                  post,
                  images,
                  context,
                  config!.GEMINI_MODEL,
                  config!.GEMINI_API_KEY,
                ),
        });
        counts[result]++;
        console.log(`${post.id}: ${result}`);
      } catch (error) {
        counts.failed++;
        console.error(
          `${post.id}: ${error instanceof SafeError ? error.message : "Processing or filesystem error; check writable directories and valid content. Existing articles were preserved."}`,
        );
      }
    }
    console.log(`Sync complete: ${JSON.stringify(counts)}`);
    if (counts.failed || counts.invalid) process.exitCode = 1;
  });
} catch (error) {
  console.error(
    error instanceof SafeError
      ? error.message
      : "Sync failed: check filesystem access and configuration. No secret-bearing diagnostics are logged.",
  );
  process.exitCode = 1;
}

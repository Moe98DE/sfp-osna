import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  readdir,
  rm,
  rename,
} from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  fixturePosts,
  fixtureImage,
  fixtureArticle,
} from "../fixtures/adapter.js";
import { normalizePost, fetchRecentPosts } from "../src/lib/instagram/index.js";
import {
  articleSlug,
  validateGenerated,
  isPublished,
} from "../src/lib/content/schema.js";
import { readArticles, writeNewArticle } from "../src/lib/content/files.js";
import { importPost, withSyncLock } from "../src/lib/content/sync.js";
import { validateMediaUrl, optimizeImage } from "../src/lib/content/media.js";
import { request } from "../src/lib/http.js";
import { parse } from "yaml";
import { generateArticle } from "../src/lib/gemini/index.js";

const fixtureRoot = process.cwd();
async function sandbox(t: { after: (fn: () => Promise<void>) => void }) {
  const parent = path.resolve("work/tests");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, "sync-"));
  t.after(async () => {
    assert.ok(root.startsWith(parent + path.sep));
    await rm(root, { recursive: true });
  });
  return root;
}
const posts = await fixturePosts(fixtureRoot);
const single = posts[0]!;
const options = (root: string, post = single) => ({
  root,
  post,
  autoPublish: true,
  model: "test",
  demo: true,
  loadImage: fixtureImage,
  generate: async (images: Parameters<typeof fixtureArticle>[1]) =>
    fixtureArticle(post, images),
});

test("normalizes images, carousel children, timestamps and reels", () => {
  assert.equal(single.media.length, 1);
  assert.equal(single.mediaType, "IMAGE");
  assert.equal(single.publishedAt, "2026-09-04T12:00:00.000Z");
  assert.equal(posts[1]!.mediaType, "CAROUSEL");
  assert.equal(posts[1]!.media.length, 2);
  assert.equal(posts[2]!.mediaType, "REEL");
  assert.ok(posts[2]!.warnings.length);
  assert.throws(() => normalizePost({ id: "../../escape" }));
  assert.throws(() =>
    normalizePost({
      id: "12",
      media_type: "IMAGE",
      permalink: "https://evil.test",
      timestamp: "yesterday",
    }),
  );
});

test("slugs are deterministic, collision-resistant by ID, and cannot escape paths", () => {
  assert.equal(articleSlug("ein-beitrag", "123"), "ein-beitrag-123");
  assert.notEqual(
    articleSlug("ein-beitrag", "123"),
    articleSlug("ein-beitrag", "456"),
  );
  for (const slug of ["../escape", "Hello", "x/y", "-x", "x--y"])
    assert.throws(() => articleSlug(slug, "1"));
  assert.throws(() => articleSlug("valid", "../1"));
});

test("rejects invalid Gemini fields, extra values, alt counts and executable markup", () => {
  const valid = JSON.parse(fixtureArticle(single, []));
  assert.equal(validateGenerated(valid, 0).needsReview, false);
  for (const patch of [
    { title: "x" },
    { metaDescription: "x".repeat(161) },
    { extra: true },
    { body: "<script>alert(1)</script> unsafe content" },
    { body: "A generated [link](javascript:alert(1)) must fail." },
    { imageAltTexts: ["Extra image"] },
    { needsReview: "false" },
    { body: "" },
  ]) {
    assert.throws(() => validateGenerated({ ...valid, ...patch }, 0));
  }
});

test("five syncs produce one article; renamed human edits are preserved byte for byte", async (t) => {
  const root = await sandbox(t);
  assert.equal(await importPost(options(root)), "created");
  const original = (await readArticles(root))[0]!;
  const edited =
    (await readFile(original.file, "utf8")) +
    "\nA human wrote this paragraph.\n";
  const nested = path.join(root, "src/content/posts/human/renamed.md");
  await mkdir(path.dirname(nested), { recursive: true });
  await rename(original.file, nested);
  await writeFile(nested, edited);
  for (let i = 0; i < 5; i++) {
    assert.equal(
      await importPost({
        ...options(root),
        loadImage: async () => {
          throw new Error("Must not download");
        },
        generate: async () => {
          throw new Error("Must not generate");
        },
      }),
      "skipped",
    );
  }
  assert.equal((await readArticles(root)).length, 1);
  assert.equal(await readFile(nested, "utf8"), edited);
  await assert.rejects(writeNewArticle(nested, original.data, "replacement"));
  assert.equal(await readFile(nested, "utf8"), edited);
});

test("carousel images are local, bounded, have dimensions and are not upscaled", async (t) => {
  const root = await sandbox(t);
  assert.equal(await importPost(options(root, posts[1]!)), "created");
  const data = (await readArticles(root))[0]!.data;
  assert.equal(data.images.length, 2);
  for (const image of data.images) {
    assert.match(image.src, /^\/media\/posts\/\d+\/\d{2}\.webp$/);
    const metadata = await sharp(
      await readFile(path.join(root, "public", image.src)),
    ).metadata();
    assert.equal(metadata.width, 1200);
    assert.equal(metadata.height, 900);
    assert.equal(metadata.format, "webp");
    assert.equal(image.smallWidth, 640);
  }
});

test("review results, warnings and AUTO_PUBLISH=false exclude drafts", async (t) => {
  const root = await sandbox(t);
  assert.equal(
    await importPost({ ...options(root), autoPublish: false }),
    "draft",
  );
  assert.equal(await importPost(options(root, posts[2]!)), "draft");
  for (const article of await readArticles(root))
    assert.equal(isPublished(article.data), false);
  assert.equal(
    isPublished({
      draft: false,
      generation: {
        generatedAt: "",
        model: "",
        needsReview: true,
        warnings: [],
      },
    }),
    false,
  );
});

test("malformed AI output is retained outside public output and saved as review draft", async (t) => {
  const root = await sandbox(t);
  const raw = '{"body":"<script>bad</script>"}';
  assert.equal(
    await importPost({ ...options(root), generate: async () => raw }),
    "invalid",
  );
  const article = (await readArticles(root))[0]!;
  assert.equal(isPublished(article.data), false);
  assert.doesNotMatch(article.body, /<script>/);
  const review = JSON.parse(
    await readFile(path.join(root, `review/${single.id}.json`), "utf8"),
  );
  assert.equal(review.rejectedModelText, raw);
});

test("image failure retains partial draft, API failure is retryable without corrupting other content", async (t) => {
  const root = await sandbox(t);
  assert.equal(
    await importPost({
      ...options(root),
      loadImage: async () => {
        throw new Error("Network");
      },
    }),
    "draft",
  );
  const saved = (await readArticles(root))[0]!;
  await assert.rejects(
    importPost({
      ...options(root, posts[1]!),
      generate: async () => {
        throw new Error("Gemini unavailable");
      },
    }),
  );
  assert.equal((await readArticles(root)).length, 1);
  assert.equal((await readArticles(root))[0]!.body, saved.body);
  assert.equal(await importPost(options(root, posts[1]!)), "created");
});

test("sync lock excludes concurrent runs and is released on failure", async (t) => {
  const root = await sandbox(t);
  await withSyncLock(root, async () => {
    await assert.rejects(
      withSyncLock(root, async () => {}),
      /locked/,
    );
  });
  await assert.rejects(
    withSyncLock(root, async () => {
      throw new Error("Failed");
    }),
  );
  await withSyncLock(root, async () => {});
});

test("CDN URL policy rejects credentials, redirects to arbitrary origins and local targets", () => {
  assert.equal(
    validateMediaUrl("https://scontent.cdninstagram.com/image.jpg").protocol,
    "https:",
  );
  for (const url of [
    "http://scontent.cdninstagram.com/x",
    "https://127.0.0.1/x",
    "https://cdninstagram.com.evil.test/x",
    "https://user:password@scontent.fbcdn.net/x",
    "file:///tmp/x",
  ])
    assert.throws(() => validateMediaUrl(url));
});

test("Meta adapter uses bearer auth, cursor pagination and skips children for known IDs", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const rawSingle = JSON.parse(
    await readFile("fixtures/instagram-single-image.json", "utf8"),
  );
  const rawCarousel = JSON.parse(
    await readFile("fixtures/instagram-carousel.json", "utf8"),
  );
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    calls++;
    const url = new URL(String(input));
    assert.equal(url.origin, "https://graph.instagram.com");
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      "Bearer fake-token",
    );
    assert.equal(url.searchParams.has("access_token"), false);
    return Response.json(
      calls === 1
        ? {
            data: [rawCarousel],
            paging: {
              next: "https://evil.test/do-not-follow",
              cursors: { after: "cursor2" },
            },
          }
        : { data: [rawSingle] },
    );
  };
  const result = [];
  for await (const item of fetchRecentPosts({
    token: "fake-token",
    userId: "123",
    version: "v26.0",
    maxPages: 2,
    knownIds: new Set([rawCarousel.id]),
  }))
    result.push(item);
  assert.equal(calls, 2);
  assert.equal(result.length, 1);
});

test("HTTP errors redact remote diagnostics, identify expired tokens, and honor long rate limits", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () =>
    Response.json(
      { error: { code: 190, message: "secret-token" } },
      { status: 400 },
    );
  await assert.rejects(
    request(new URL("https://graph.instagram.com/")),
    (error: Error) =>
      /expired/.test(error.message) && !/secret-token/.test(error.message),
  );
  globalThis.fetch = async () =>
    new Response("", { status: 429, headers: { "Retry-After": "120" } });
  await assert.rejects(
    request(new URL("https://graph.instagram.com/")),
    /next scheduled run/,
  );
});

test("workflow YAML parses and uses bounded permissions and a shared publishing lock", async () => {
  for (const name of await readdir(".github/workflows")) {
    const workflow = parse(
      await readFile(path.join(".github/workflows", name), "utf8"),
    );
    assert.ok(workflow.on);
    assert.ok(workflow.jobs);
    assert.equal(workflow.concurrency["cancel-in-progress"], false);
    assert.ok(["read", "write"].includes(workflow.permissions.contents));
  }
});

test("official Gemini SDK sends stateless structured multimodal input and reads its JSON result", async (t) => {
  const root = await sandbox(t);
  const image = await optimizeImage(
    root,
    single.id,
    1,
    await fixtureImage(single.media[0]!.url),
  );
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  let called = false;
  const expected = fixtureArticle(single, [image]);
  globalThis.fetch = async (input, init) => {
    called = true;
    const req = input instanceof Request ? input : new Request(input, init);
    const body = (await req.json()) as Record<string, unknown>;
    assert.equal(
      new URL(req.url).hostname,
      "generativelanguage.googleapis.com",
    );
    assert.equal(body.store, false);
    assert.equal(body.model, "gemini-3.8-flash");
    assert.equal(
      (body.response_format as { mime_type: string }).mime_type,
      "application/json",
    );
    assert.ok(String(body.system_instruction).includes("Never fabricate"));
    const inputs = body.input as {
      type: string;
      mime_type?: string;
      data?: string;
    }[];
    assert.equal(inputs[1]!.type, "image");
    assert.equal(inputs[1]!.mime_type, "image/webp");
    assert.ok(inputs[1]!.data!.length > 100);
    return Response.json({
      id: "test-interaction",
      status: "completed",
      output_text: expected,
      model: "gemini-3.8-flash",
      steps: [],
    });
  };
  assert.equal(
    await generateArticle(
      root,
      single,
      [image],
      "Verified context",
      "gemini-3.8-flash",
      "fake-key-for-offline-test",
    ),
    expected,
  );
  assert.ok(called);
});

test("Neocities upload preserves paths and prunes only withdrawn generated files", async (t) => {
  const root = await sandbox(t);
  const originalCwd = process.cwd();
  const originalFetch = globalThis.fetch;
  const oldKey = process.env.NEOCITIES_API_KEY;
  const oldSite = process.env.SITE_URL;
  const calls: string[] = [];
  await mkdir(path.join(root, "dist"));
  await writeFile(
    path.join(root, "dist/index.html"),
    '<link rel="canonical" href="https://test.neocities.org/">',
  );
  try {
    process.chdir(root);
    process.env.NEOCITIES_API_KEY = "offline-neocities-key";
    process.env.SITE_URL = "https://test.neocities.org";
    globalThis.fetch = async (input, init) => {
      const req = new Request(input, init);
      const endpoint = new URL(req.url).pathname;
      calls.push(endpoint);
      assert.equal(
        req.headers.get("authorization"),
        "Bearer offline-neocities-key",
      );
      if (endpoint === "/api/list")
        return Response.json({
          result: "success",
          files: [
            { path: "posts/withdrawn-123/index.html", is_directory: false },
            { path: "media/posts/123/01.webp", is_directory: false },
            { path: "unrelated.html", is_directory: false },
          ],
        });
      if (endpoint === "/api/upload")
        assert.ok((await req.formData()).has("index.html"));
      if (endpoint === "/api/delete") {
        const form = new URLSearchParams(await req.text());
        assert.deepEqual(form.getAll("filenames[]"), [
          "posts/withdrawn-123/index.html",
          "media/posts/123/01.webp",
        ]);
      }
      return Response.json({ result: "success" });
    };
    await import("../scripts/deploy-neocities.js");
    assert.deepEqual(calls, ["/api/list", "/api/upload", "/api/delete"]);
  } finally {
    process.chdir(originalCwd);
    globalThis.fetch = originalFetch;
    if (oldKey === undefined) delete process.env.NEOCITIES_API_KEY;
    else process.env.NEOCITIES_API_KEY = oldKey;
    if (oldSite === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = oldSite;
  }
});

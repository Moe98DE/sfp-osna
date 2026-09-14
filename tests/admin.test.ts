import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { once } from "node:events";
import { get as httpGet } from "node:http";
import {
  fixturePosts,
  fixtureImage,
  fixtureArticle,
} from "../fixtures/adapter.js";
import { importPost } from "../src/lib/content/sync.js";
import { readArticles } from "../src/lib/content/files.js";
import {
  adminArticle,
  adminList,
  saveArticle,
  deleteArticle,
  restoreArticle,
} from "../src/lib/admin/articles.js";
import { startAdmin } from "../src/lib/admin/server.js";
import { fetchRecentPosts } from "../src/lib/instagram/index.js";

const repo = process.cwd();
const single = (await fixturePosts(repo))[0]!;
async function sandbox(t: { after: (fn: () => Promise<void>) => void }) {
  const parent = path.resolve(repo, "work/admin-tests");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, "admin-"));
  t.after(async () => {
    assert.ok(root.startsWith(parent + path.sep));
    await rm(root, { recursive: true });
  });
  return root;
}
const seed = (root: string) =>
  importPost({
    root,
    post: single,
    model: "test",
    autoPublish: true,
    loadImage: fixtureImage,
    generate: async (images) => fixtureArticle(single, images),
  });
function payload(article: Awaited<ReturnType<typeof adminArticle>>) {
  return {
    id: article.id,
    revision: article.revision,
    title: article.data.title,
    description: article.data.description,
    summary: article.data.summary,
    body: article.body,
    tags: article.data.tags,
    altTexts: article.data.images.map((i) => i.alt),
    draft: article.data.draft,
    reviewed: !article.data.generation.needsReview,
  };
}
test("admin edits preserve provenance and custom metadata; stale edits and unreviewed publication fail", async (t) => {
  const root = await sandbox(t);
  await seed(root);
  const file = (await readArticles(root))[0]!.file;
  await writeFile(
    file,
    (await readFile(file, "utf8")).replace(
      "---\n",
      "---\ncustomNote: preserve-this\n",
    ),
  );
  const before = await adminArticle(root, single.id);
  const updated = await saveArticle(root, {
    ...payload(before),
    title: "Von Hand bearbeiteter Artikel",
    body: "Dieser Text wurde von einem Menschen redigiert.",
    draft: true,
  });
  assert.equal(updated.data.title, "Von Hand bearbeiteter Artikel");
  assert.deepEqual(updated.data.instagram, before.data.instagram);
  assert.equal(updated.data.generation.model, "test");
  assert.match(await readFile(file, "utf8"), /customNote: preserve-this/);
  await assert.rejects(saveArticle(root, payload(before)), /changed since/);
  await assert.rejects(
    saveArticle(root, { ...payload(updated), draft: false, reviewed: false }),
    /review/,
  );
  await assert.rejects(
    saveArticle(root, { ...payload(updated), altTexts: [] }),
    /alt text/,
  );
  assert.equal(await seed(root), "skipped");
  assert.equal((await adminArticle(root, single.id)).body, updated.body);
});
test("delete is restorable, prevents reimport, and restore retains the URL as a draft", async (t) => {
  const root = await sandbox(t);
  await seed(root);
  const article = await adminArticle(root, single.id);
  const filename = (await readArticles(root))[0]!.file;
  await assert.rejects(
    deleteArticle(root, single.id, "outdated"),
    /changed since/,
  );
  await deleteArticle(root, single.id, article.revision);
  assert.equal((await adminList(root)).articles.length, 0);
  assert.equal((await adminList(root)).deleted.length, 1);
  assert.equal(await seed(root), "skipped");
  await restoreArticle(root, single.id);
  assert.equal((await readArticles(root))[0]!.file, filename);
  const restored = await adminArticle(root, single.id);
  assert.equal(restored.data.draft, true);
  assert.equal(restored.body, article.body);
  assert.equal((await adminList(root)).deleted.length, 0);
  await assert.rejects(restoreArticle(root, "../escape"));
});
test("local admin rejects foreign origins and missing CSRF tokens, accepts authorized editing", async (t) => {
  const root = await sandbox(t);
  await seed(root);
  await mkdir(path.join(root, "admin"));
  await writeFile(
    path.join(root, "admin/index.html"),
    '<meta name="admin-token" content="__CSRF__">',
  );
  const server = startAdmin(root, 0);
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  const page = await fetch(origin);
  const html = await page.text();
  const token = /content="([a-f0-9]+)"/.exec(html)![1]!;
  assert.ok(
    page.headers
      .get("content-security-policy")!
      .includes("frame-ancestors 'none'"),
  );
  assert.equal(
    (
      await fetch(`${origin}/api/articles`, {
        headers: { Origin: "https://evil.test" },
      })
    ).status,
    403,
  );
  const foreignHostStatus = await new Promise<number | undefined>(
    (resolve, reject) => {
      const req = httpGet(
        origin,
        { headers: { Host: "evil.test" } },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      );
      req.on("error", reject);
    },
  );
  assert.equal(foreignHostStatus, 403);
  const article = await adminArticle(root, single.id);
  const request = {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({
      ...payload(article),
      title: "Änderung über lokalen Admin",
    }),
  };
  assert.equal((await fetch(`${origin}/api/save`, request)).status, 403);
  assert.equal(
    (
      await fetch(`${origin}/api/save`, {
        ...request,
        headers: { ...request.headers, "X-Admin-Token": token },
      })
    ).status,
    200,
  );
  assert.equal(
    (await adminArticle(root, single.id)).data.title,
    "Änderung über lokalen Admin",
  );
});
test("newest mode scans unordered pages but hydrates only the newest post; all mode skips known IDs", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const raw = JSON.parse(
    await readFile(
      path.join(repo, "fixtures/instagram-single-image.json"),
      "utf8",
    ),
  );
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return Response.json(
      requests === 1
        ? {
            data: [{ ...raw, id: "100", timestamp: "2020-01-01T00:00:00Z" }],
            paging: { next: "unused", cursors: { after: "page2" } },
          }
        : { data: [{ ...raw, id: "101", timestamp: "2026-09-05T00:00:00Z" }] },
    );
  };
  const options = {
    token: "fake",
    userId: "123",
    version: "v26.0",
    maxPages: Infinity,
    knownIds: new Set<string>(),
  };
  const latest = [];
  for await (const result of fetchRecentPosts({ ...options, newestOnly: true }))
    latest.push(result);
  assert.equal(requests, 2);
  assert.equal(latest.length, 1);
  assert.equal(latest[0]?.post?.id, "101");
  requests = 0;
  const all = [];
  for await (const result of fetchRecentPosts({
    ...options,
    knownIds: new Set(["100"]),
  }))
    all.push(result);
  assert.equal(all.length, 1);
  assert.equal(all[0]?.post?.id, "101");
  requests = 0;
  const alreadyExists = [];
  for await (const result of fetchRecentPosts({
    ...options,
    newestOnly: true,
    knownIds: new Set(["101"]),
  }))
    alreadyExists.push(result);
  assert.equal(alreadyExists.length, 0);
});

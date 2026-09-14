import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { readArticles } from "../src/lib/content/files.js";
import { isPublished } from "../src/lib/content/schema.js";

// The build runs in a separate process from this verifier, so load local
// credentials here as well when checking that no secret reached static output.
if (existsSync(".env")) process.loadEnvFile(".env");
const dist = path.resolve("dist");
const files = await readdir(dist, { recursive: true });
assert.ok(
  !files.some((file) => path.basename(file).startsWith(".")),
  "Hidden placeholder or private file leaked into static output",
);
assert.ok(
  !files.some((f) => /(^|[\\/])(?:admin|archive)(?:[\\/.]|$)/.test(f)),
  "Local admin or trash leaked into static output",
);
for (const required of [
  "index.html",
  "posts/index.html",
  "about/index.html",
  "contact/index.html",
  "rss.xml",
  "robots.txt",
  "sitemap-index.xml",
])
  assert.ok(
    files.includes(required.replaceAll("/", path.sep)),
    `Missing ${required}`,
  );
const html = await Promise.all(
  files
    .filter((f) => f.endsWith(".html"))
    .map(async (f) => ({
      file: f,
      text: await readFile(path.join(dist, f), "utf8"),
    })),
);
const allText = html.map((f) => f.text).join("\n");
const xmlText = (
  await Promise.all(
    files
      .filter((f) => f.endsWith(".xml"))
      .map((f) => readFile(path.join(dist, f), "utf8")),
  )
).join("\n");
const archive = html.find(
  (f) => f.file === path.join("posts", "index.html"),
)!.text;
assert.doesNotMatch(
  allText,
  /<script(?![^>]*type="application\/ld\+json")[^>]*>/i,
  "Visitors should need no scripts",
);
const allowedMedia = new Set<string>();
for (const article of await readArticles(process.cwd())) {
  const name = path
    .relative(path.resolve("src/content/posts"), article.file)
    .replaceAll(path.sep, "/")
    .replace(/\.md$/, "");
  const route = `posts/${name}/index.html`.replaceAll("/", path.sep);
  if (!isPublished(article.data)) {
    assert.ok(!files.includes(route), `Draft route leaked: ${route}`);
    assert.ok(
      !(allText + xmlText).includes(`/posts/${name}/`),
      `Draft link leaked: ${name}`,
    );
    continue;
  }
  assert.ok(
    archive.includes(`/posts/${name}/`),
    `Published article missing from archive: ${name}`,
  );
  assert.ok(
    xmlText.includes(`/posts/${name}/`),
    `Published article missing from feeds/sitemap: ${name}`,
  );
  const page = html.find((f) => f.file === route)?.text;
  assert.ok(page, `Published route missing: ${route}`);
  for (const expected of [
    'name="description"',
    'rel="canonical"',
    'property="og:title"',
    '"@type":"BlogPosting"',
    '"@type":"BreadcrumbList"',
  ])
    assert.ok(page.includes(expected), `${route}: missing ${expected}`);
  for (const image of article.data.images) {
    for (const src of [image.src, image.smallSrc]) {
      allowedMedia.add(src);
      assert.ok(
        (await stat(path.join(dist, src))).isFile(),
        `Missing image ${src}`,
      );
    }
  }
}
for (const file of files.filter((f) => f.endsWith(".webp")))
  assert.ok(
    allowedMedia.has("/" + file.replaceAll(path.sep, "/")),
    `Unpublished media leaked: ${file}`,
  );
for (const { file, text } of html) {
  assert.ok(
    text.includes('"@type":"Organization"'),
    `${file}: missing organization schema`,
  );
  for (const match of text.matchAll(/(?:href|src)="(\/[^"#?]*)[^"]*"/g)) {
    const pathname = match[1]!;
    const target = path.join(
      dist,
      pathname.endsWith("/") ? `${pathname}index.html` : pathname,
    );
    assert.ok(
      (await stat(target)).isFile(),
      `${file}: broken internal URL ${pathname}`,
    );
  }
}
const staticText = (
  await Promise.all(
    files
      .filter((f) => /\.(?:html|js|css|xml|txt|json|svg)$/.test(f))
      .map((f) => readFile(path.join(dist, f), "utf8")),
  )
).join("\n");
for (const secretName of [
  "INSTAGRAM_ACCESS_TOKEN",
  "GEMINI_API_KEY",
  "NEOCITIES_API_KEY",
]) {
  assert.ok(!staticText.includes(secretName));
  const value = process.env[secretName];
  if (value && value.length > 5)
    assert.ok(!staticText.includes(value), `Secret leaked: ${secretName}`);
}
assert.ok(
  !files.some((f) => /(^|[\\/])(?:review|src|\.env)(?:[\\/]|$)/.test(f)),
);
console.log(
  `Verified ${html.length} static pages: metadata, links, local images, no visitor scripts, no drafts or private content.`,
);

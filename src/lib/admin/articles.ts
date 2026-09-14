import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  unlink,
  link,
} from "node:fs/promises";
import path from "node:path";
import { parse, stringify } from "yaml";
import { format } from "prettier";
import { z } from "zod";
import { readArticles } from "../content/files.js";
import { deletedArticles } from "../content/deleted.js";
import { articleSchema, mediaIdSchema } from "../content/schema.js";
import { withSyncLock } from "../content/sync.js";

export class AdminError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const revision = (text: string) =>
  createHash("sha256").update(text).digest("hex");
export const editSchema = z.strictObject({
  id: mediaIdSchema,
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  title: z.string().trim().min(1).max(110),
  description: z.string().trim().min(1).max(160),
  summary: z.string().trim().min(1).max(350),
  body: z.string().trim().min(1).max(200000),
  tags: z.array(z.string().trim().min(1).max(80)).max(30),
  altTexts: z.array(z.string().trim().min(1).max(300)).max(20),
  draft: z.boolean(),
  reviewed: z.boolean(),
});
function split(markdown: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(
    markdown,
  );
  if (!match) throw new AdminError("Invalid article frontmatter.");
  const metadata = parse(match[1]!) as Record<string, unknown>;
  articleSchema.parse(metadata);
  return { metadata, body: match[2]! };
}
async function serialize(metadata: Record<string, unknown>, body: string) {
  articleSchema.parse(metadata);
  return format(`---\n${stringify(metadata)}---\n\n${body.trim()}\n`, {
    parser: "markdown",
  });
}
async function atomicWrite(file: string, text: string, replace = false) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, text, { flag: "wx" });
    if (replace) {
      // Windows can briefly deny replacement while an indexer scans the old file.
      for (let attempt = 0; ; attempt++) {
        try {
          await rename(temp, file);
          break;
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (
            process.platform !== "win32" ||
            attempt === 2 ||
            !["EPERM", "EACCES", "EBUSY"].includes(code ?? "")
          )
            throw error;
          await new Promise((resolve) =>
            setTimeout(resolve, 50 * (attempt + 1)),
          );
        }
      }
    } else await link(temp, file);
  } finally {
    await unlink(temp).catch(() => {});
  }
}
async function find(root: string, id: string) {
  mediaIdSchema.parse(id);
  const article = (await readArticles(root)).find(
    (a) => a.data.instagram.mediaId === id,
  );
  if (!article)
    throw new AdminError("Article not found. Refresh the list.", 404);
  const markdown = await readFile(article.file, "utf8");
  return { ...article, markdown, revision: revision(markdown) };
}
export async function adminList(root: string) {
  return {
    articles: (await readArticles(root))
      .map((a) => ({
        id: a.data.instagram.mediaId,
        title: a.data.title,
        publishedAt: a.data.publishedAt,
        draft: a.data.draft,
        needsReview: a.data.generation.needsReview,
        demo: a.data.demo,
      }))
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)),
    deleted: (await deletedArticles(root)).map(({ id, title, deletedAt }) => ({
      id,
      title,
      deletedAt,
    })),
  };
}
export async function adminArticle(root: string, id: string) {
  const article = await find(root, id);
  let caption = "";
  try {
    caption = String(
      (
        JSON.parse(
          await readFile(path.join(root, "review", `${id}.json`), "utf8"),
        ) as { caption?: string }
      ).caption ?? "",
    );
  } catch {
    /* A caption is optional for human-written content. */
  }
  return {
    id,
    data: article.data,
    body: article.body.trim(),
    revision: article.revision,
    caption,
  };
}
function checkRevision(current: string, expected: string) {
  if (current !== expected)
    throw new AdminError(
      "This article changed since you opened it. Reload it before saving; your changes have not been written.",
      409,
    );
}
export async function saveArticle(root: string, input: unknown) {
  const edit = editSchema.parse(input);
  if (!edit.draft && !edit.reviewed)
    throw new AdminError("Confirm factual review before publishing.");
  return withSyncLock(root, async () => {
    const article = await find(root, edit.id);
    checkRevision(article.revision, edit.revision);
    if (edit.altTexts.length !== article.data.images.length)
      throw new AdminError("Provide alt text for every image.");
    const { metadata } = split(article.markdown);
    const next = {
      ...metadata,
      title: edit.title,
      description: edit.description,
      summary: edit.summary,
      tags: edit.tags,
      draft: edit.draft,
      updatedAt: new Date().toISOString(),
      images: article.data.images.map((image, index) => ({
        ...image,
        alt: edit.altTexts[index],
      })),
      generation: {
        ...(metadata.generation as object),
        needsReview: !edit.reviewed,
      },
    };
    const markdown = await serialize(next, edit.body);
    const backup = path.join(
      root,
      "work/admin-backups",
      edit.id,
      `${article.revision}.md`,
    );
    await mkdir(path.dirname(backup), { recursive: true });
    await writeFile(backup, article.markdown);
    checkRevision(
      revision(await readFile(article.file, "utf8")),
      edit.revision,
    );
    await atomicWrite(article.file, markdown, true);
    return adminArticle(root, edit.id);
  });
}
export async function deleteArticle(
  root: string,
  id: string,
  expectedRevision: string,
) {
  return withSyncLock(root, async () => {
    const article = await find(root, id);
    checkRevision(article.revision, expectedRevision);
    const record = {
      id,
      title: article.data.title,
      deletedAt: new Date().toISOString(),
      relativeFile: path
        .relative(path.join(root, "src/content/posts"), article.file)
        .replaceAll(path.sep, "/"),
      markdown: article.markdown,
    };
    const trashFile = path.join(root, "archive/deleted", `${id}.json`);
    await atomicWrite(
      trashFile,
      await format(JSON.stringify(record), { parser: "json" }),
    );
    // Save the restorable record before removing the article. Media stays local;
    // the production build excludes it while the article is in trash.
    checkRevision(
      revision(await readFile(article.file, "utf8")),
      expectedRevision,
    );
    await unlink(article.file);
  });
}
export async function restoreArticle(root: string, id: string) {
  mediaIdSchema.parse(id);
  return withSyncLock(root, async () => {
    const record = (await deletedArticles(root)).find((a) => a.id === id);
    if (!record) throw new AdminError("Deleted article not found.", 404);
    if ((await readArticles(root)).some((a) => a.data.instagram.mediaId === id))
      throw new AdminError("An article with this ID already exists.", 409);
    const base = path.resolve(root, "src/content/posts");
    const file = path.resolve(base, record.relativeFile);
    if (!file.startsWith(base + path.sep) || !file.endsWith(".md"))
      throw new AdminError("Unsafe archived article path.");
    const { metadata, body } = split(record.markdown);
    if (articleSchema.parse(metadata).instagram.mediaId !== id)
      throw new AdminError("Archived ID mismatch.");
    await atomicWrite(
      file,
      await serialize(
        { ...metadata, draft: true, updatedAt: new Date().toISOString() },
        body,
      ),
    );
    await unlink(path.join(root, "archive/deleted", `${id}.json`));
  });
}

import {
  readdir,
  readFile,
  mkdir,
  writeFile,
  link,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { parse, stringify } from "yaml";
import { format } from "prettier";
import { articleSchema, type ArticleData } from "./schema.js";
import { SafeError } from "../http.js";

export async function readArticles(
  root: string,
): Promise<{ file: string; data: ArticleData; body: string }[]> {
  const folder = path.join(root, "src/content/posts");
  await mkdir(folder, { recursive: true });
  const files = await readdir(folder, { recursive: true });
  const result = [];
  const ids = new Set<string>();
  for (const relative of files.filter((f) => f.endsWith(".md"))) {
    const file = path.join(folder, relative);
    const text = await readFile(file, "utf8");
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(text);
    if (!match)
      throw new SafeError(
        `Invalid frontmatter in ${relative}; fix it before syncing`,
      );
    let data: ArticleData;
    try {
      data = articleSchema.parse(parse(match[1]!));
    } catch {
      throw new SafeError(
        `Invalid article metadata in ${relative}; fix it before syncing`,
      );
    }
    if (ids.has(data.instagram.mediaId))
      throw new SafeError(
        `Duplicate Instagram ID in ${relative}; resolve before syncing`,
      );
    ids.add(data.instagram.mediaId);
    result.push({ file, data, body: match[2]! });
  }
  return result;
}

export async function writeNewArticle(
  file: string,
  data: ArticleData,
  body: string,
) {
  const validated = articleSchema.parse(data);
  const temp = `${file}.${randomUUID()}.tmp`;
  await mkdir(path.dirname(file), { recursive: true });
  try {
    const markdown = await format(
      `---\n${stringify(validated)}---\n\n${body.trim()}\n`,
      { parser: "markdown" },
    );
    await writeFile(temp, markdown, { flag: "wx" });
    // An atomic hard link fails if the destination exists; no rename-overwrite window.
    await link(temp, file);
  } finally {
    await unlink(temp).catch(() => {});
  }
}

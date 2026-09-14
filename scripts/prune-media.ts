import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { readArticles } from "../src/lib/content/files.js";
import { isPublished } from "../src/lib/content/schema.js";

export async function pruneMedia(root: string) {
  const allowed = new Set(
    (await readArticles(root))
      .filter((a) => isPublished(a.data))
      .flatMap((a) => a.data.images.flatMap((i) => [i.src, i.smallSrc])),
  );
  const folder = path.resolve(root, "dist/media/posts");
  let files: string[];
  try {
    files = await readdir(folder, { recursive: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const relative of files) {
    if (!relative.endsWith(".webp")) continue;
    if (!allowed.has(`/media/posts/${relative.replaceAll(path.sep, "/")}`)) {
      const target = path.resolve(folder, relative);
      if (!target.startsWith(folder + path.sep))
        throw new Error("Unsafe output media path");
      await rm(target);
    }
  }
}
await pruneMedia(process.cwd());

import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { mediaIdSchema } from "./schema.js";

export const deletedSchema = z.object({
  id: mediaIdSchema,
  title: z.string(),
  deletedAt: z.iso.datetime(),
  relativeFile: z.string(),
  markdown: z.string(),
});
export async function deletedArticles(root: string) {
  const folder = path.join(root, "archive/deleted");
  await mkdir(folder, { recursive: true });
  return Promise.all(
    (await readdir(folder))
      .filter((file) => /^\d{1,40}\.json$/.test(file))
      .map(async (file) => {
        const record = deletedSchema.parse(
          JSON.parse(await readFile(path.join(folder, file), "utf8")),
        );
        if (`${record.id}.json` !== file)
          throw new Error("Deleted article ID mismatch");
        return record;
      }),
  );
}

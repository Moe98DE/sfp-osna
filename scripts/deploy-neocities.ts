import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { request, SafeError } from "../src/lib/http.js";

// Keep deployment independent of Astro and content import. dist/ is the contract.
const root = path.resolve("dist");
const key = process.env.NEOCITIES_API_KEY;
try {
  if (!key) throw new SafeError("Set NEOCITIES_API_KEY before deploying");
  const origin = new URL(process.env.SITE_URL || "https://example.org");
  if (origin.hostname === "example.org")
    throw new SafeError(
      "Set SITE_URL to your real public origin and rebuild before deploying",
    );
  const index = await readFile(path.join(root, "index.html"), "utf8");
  if (!index.includes(`href="${origin.origin}/"`))
    throw new SafeError(
      "Built canonical URL differs from SITE_URL; rebuild first",
    );
  const headers = { Authorization: `Bearer ${key}` };
  const remoteSchema = z.object({
    result: z.literal("success"),
    files: z.array(
      z.object({
        path: z.string(),
        is_directory: z.boolean(),
        sha1_hash: z.string().optional(),
      }),
    ),
  });
  const remote = remoteSchema.parse(
    await (
      await request(
        new URL("https://neocities.org/api/list"),
        { headers },
        "Neocities list",
      )
    ).json(),
  );
  const hashes = new Map(remote.files.map((f) => [f.path, f.sha1_hash]));
  const names = (await readdir(root, { recursive: true })).sort();
  const form = new FormData();
  let changed = 0;
  let bytes = 0;
  for (const name of names) {
    const file = path.join(root, name);
    if (!(await stat(file)).isFile()) continue;
    const remotePath = name.replaceAll(path.sep, "/");
    const buffer = await readFile(file);
    if (
      hashes.get(remotePath) === createHash("sha1").update(buffer).digest("hex")
    )
      continue;
    bytes += buffer.length;
    if (bytes > 100 * 1024 * 1024)
      throw new SafeError(
        "Upload exceeds the script's 100 MB batch limit; upload dist manually or split the deployment",
      );
    form.append(
      remotePath,
      new Blob([new Uint8Array(buffer)]),
      path.basename(file),
    );
    changed++;
  }
  if (changed) {
    const result = (await (
      await request(
        new URL("https://neocities.org/api/upload"),
        { method: "POST", headers, body: form },
        "Neocities upload",
      )
    ).json()) as { result?: string };
    if (result.result !== "success")
      throw new SafeError(
        "Neocities rejected the upload; check storage limits and allowed file types",
      );
  }
  // Remove only generated article/media paths that disappeared from this build.
  // This is necessary when an already-published article is later withdrawn.
  // Other remote pages/assets are outside this script's ownership.
  const local = new Set(names.map((n) => n.replaceAll(path.sep, "/")));
  const stale = remote.files.filter(
    (f) =>
      !f.is_directory &&
      !local.has(f.path) &&
      /^(?:posts\/[a-z0-9-]+-\d{1,40}\/index\.html|media\/posts\/\d{1,40}\/\d{2}(?:-640)?\.webp)$/.test(
        f.path,
      ),
  );
  if (stale.length) {
    const body = new URLSearchParams();
    for (const file of stale) body.append("filenames[]", file.path);
    const result = (await (
      await request(
        new URL("https://neocities.org/api/delete"),
        { method: "POST", headers, body },
        "Neocities prune",
      )
    ).json()) as { result?: string };
    if (result.result !== "success")
      throw new SafeError(
        "Neocities could not remove withdrawn content; inspect remote files manually",
      );
  }
  console.log(
    `Neocities: uploaded ${changed} changed files; removed ${stale.length} obsolete generated files.`,
  );
} catch (error) {
  console.error(
    error instanceof SafeError
      ? error.message
      : "Deployment failed: check dist/, SITE_URL, token access, storage and file permissions. Remote deployment may be partial; rerun after fixing.",
  );
  process.exitCode = 1;
}

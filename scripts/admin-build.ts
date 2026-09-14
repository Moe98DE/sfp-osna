import { spawn } from "node:child_process";
import { withSyncLock } from "../src/lib/content/sync.js";
import { SafeError } from "../src/lib/http.js";
try {
  await withSyncLock(process.cwd(), async () => {
    for (const args of [
      ["node_modules/astro/bin/astro.mjs", "build"],
      ["--import", "tsx", "scripts/prune-media.ts"],
      ["--import", "tsx", "scripts/verify-build.ts"],
    ]) {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(process.execPath, args, {
          stdio: "inherit",
          windowsHide: true,
        });
        child.on("error", reject);
        child.on("close", (code) =>
          code === 0
            ? resolve()
            : reject(
                new SafeError("Build failed. Read the diagnostics above."),
              ),
        );
      });
    }
  });
} catch (error) {
  console.error(
    error instanceof SafeError ? error.message : "Could not build the site.",
  );
  process.exitCode = 1;
}

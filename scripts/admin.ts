import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startAdmin } from "../src/lib/admin/server.js";
if (existsSync(".env")) process.loadEnvFile(".env");
const server = startAdmin(process.cwd(), 4322);
server.on("error", () => {
  console.error(
    "Cannot start admin at 127.0.0.1:4322. Check whether npm run admin is already running.",
  );
  process.exitCode = 1;
});
server.on("listening", () =>
  console.log(
    `Local admin: http://127.0.0.1:4322/\nStop with Ctrl+C. Source: ${fileURLToPath(import.meta.url)}`,
  ),
);

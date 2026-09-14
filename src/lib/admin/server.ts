import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { z } from "zod";
import {
  adminList,
  adminArticle,
  saveArticle,
  deleteArticle,
  restoreArticle,
  AdminError,
} from "./articles.js";
import { SafeError } from "../http.js";
import { mediaIdSchema } from "../content/schema.js";

type Job = {
  action: string;
  running: boolean;
  log: string;
  exitCode: number | null;
};
export function startAdmin(root: string, port = 4322) {
  const csrf = randomBytes(32).toString("hex");
  let job: Job | null = null;
  const server = createServer(async (req, res) => {
    const address = server.address();
    const actualPort =
      typeof address === "object" && address ? address.port : port;
    const origin = `http://127.0.0.1:${actualPort}`;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    res.setHeader("Referrer-Policy", "no-referrer");
    try {
      if (req.headers.host !== `127.0.0.1:${actualPort}`)
        throw new AdminError("Invalid local host.", 403);
      if (req.headers.origin && req.headers.origin !== origin)
        throw new AdminError("Cross-origin access is blocked.", 403);
      const url = new URL(req.url ?? "/", origin);
      if (req.method === "GET") {
        if (url.pathname === "/") {
          const html = (
            await readFile(path.join(root, "admin/index.html"), "utf8")
          ).replace("__CSRF__", csrf);
          return send(res, html, "text/html; charset=utf-8");
        }
        if (["/admin.js", "/admin.css"].includes(url.pathname))
          return send(
            res,
            await readFile(path.join(root, "admin", url.pathname.slice(1))),
            url.pathname.endsWith(".js") ? "text/javascript" : "text/css",
          );
        if (url.pathname === "/api/articles")
          return json(res, await adminList(root));
        if (url.pathname === "/api/article")
          return json(
            res,
            await adminArticle(
              root,
              mediaIdSchema.parse(url.searchParams.get("id")),
            ),
          );
        if (url.pathname === "/api/status")
          return json(res, {
            job,
            configured: Boolean(
              process.env.INSTAGRAM_ACCESS_TOKEN &&
              process.env.INSTAGRAM_USER_ID &&
              process.env.INSTAGRAM_API_VERSION &&
              process.env.GEMINI_API_KEY,
            ),
            autoPublish: process.env.AUTO_PUBLISH === "true",
          });
        if (
          /^\/media\/posts\/\d{1,40}\/\d{2}(?:-640)?\.webp$/.test(url.pathname)
        )
          return send(
            res,
            await readFile(path.join(root, "public", url.pathname)),
            "image/webp",
          );
      }
      if (
        req.method !== "POST" ||
        req.headers["x-admin-token"] !== csrf ||
        req.headers.origin !== origin
      )
        throw new AdminError("Local admin authorization required.", 403);
      if (job?.running)
        throw new AdminError(
          "Wait for the current import or build to finish.",
          409,
        );
      const body = await readJson(req);
      if (job?.running)
        throw new AdminError(
          "Wait for the current import or build to finish.",
          409,
        );
      if (url.pathname === "/api/save")
        return json(res, await saveArticle(root, body));
      if (url.pathname === "/api/delete") {
        const input = z
          .strictObject({ id: mediaIdSchema, revision: z.string() })
          .parse(body);
        await deleteArticle(root, input.id, input.revision);
        return json(res, { ok: true });
      }
      if (url.pathname === "/api/restore") {
        await restoreArticle(
          root,
          z.strictObject({ id: mediaIdSchema }).parse(body).id,
        );
        return json(res, { ok: true });
      }
      if (url.pathname === "/api/job") {
        const { action } = z
          .strictObject({
            action: z.enum(["newest", "all", "fixture", "build"]),
          })
          .parse(body);
        job = { action, running: true, log: "", exitCode: null };
        const current = job;
        const args =
          action === "build"
            ? ["--import", "tsx", "scripts/admin-build.ts"]
            : [
                "--import",
                "tsx",
                "--env-file-if-exists=.env",
                "scripts/sync-instagram.ts",
                action === "newest"
                  ? "--newest"
                  : action === "all"
                    ? "--all"
                    : "--fixture",
              ];
        const child = spawn(process.execPath, args, {
          cwd: root,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        });
        const append = (data: Buffer) => {
          let text = data.toString();
          for (const key of [
            "INSTAGRAM_ACCESS_TOKEN",
            "GEMINI_API_KEY",
            "NEOCITIES_API_KEY",
          ]) {
            const secret = process.env[key];
            if (secret) text = text.replaceAll(secret, "[redacted]");
          }
          current.log = (current.log + text).slice(-32000);
        };
        child.stdout.on("data", append);
        child.stderr.on("data", append);
        child.on("error", () => {
          current.running = false;
          current.exitCode = 1;
          current.log +=
            "Could not start the command. Check Node and file permissions.";
        });
        child.on("close", (code) => {
          current.running = false;
          current.exitCode = code ?? 1;
        });
        return json(res, { job: current }, 202);
      }
      throw new AdminError("Not found.", 404);
    } catch (error) {
      if (res.headersSent) {
        res.end();
        return;
      }
      json(
        res,
        {
          error:
            error instanceof AdminError || error instanceof SafeError
              ? error.message
              : error instanceof z.ZodError
                ? "Invalid fields. Check lengths, article ID, and image descriptions."
                : "Could not complete the operation. Check local files and permissions; refresh before retrying.",
        },
        error instanceof AdminError
          ? error.status
          : error instanceof SafeError
            ? 409
            : 400,
      );
    }
  });
  return server.listen(port, "127.0.0.1");
}
function send(res: ServerResponse, body: string | Buffer, type: string) {
  res.setHeader("Content-Type", type);
  res.end(body);
}
function json(res: ServerResponse, data: unknown, status = 200) {
  res.statusCode = status;
  send(res, JSON.stringify(data), "application/json");
}
async function readJson(req: IncomingMessage): Promise<unknown> {
  if (!req.headers["content-type"]?.startsWith("application/json"))
    throw new AdminError("Expected JSON.", 415);
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new AdminError("Article is too large.", 413);
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

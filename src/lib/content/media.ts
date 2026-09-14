import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { mediaIdSchema, type LocalImage } from "./schema.js";
import { request, SafeError } from "../http.js";

export function validateMediaUrl(value: string): URL {
  const url = new URL(value);
  const allowed = ["cdninstagram.com", "fbcdn.net"];
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !allowed.some(
      (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
    )
  ) {
    throw new SafeError(
      "Media: expected an HTTPS Meta CDN URL; review the adapter if Meta changed its CDN",
    );
  }
  return url;
}
export async function downloadImage(value: string) {
  const response = await request(validateMediaUrl(value), {}, "Media download");
  if (
    !/^image\/(jpeg|png|webp)(?:;|$)/i.test(
      response.headers.get("content-type") ?? "",
    )
  )
    throw new SafeError("Media: unsupported image content type");
  const limit = 20 * 1024 * 1024;
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel();
    throw new SafeError("Media: image exceeds 20 MB limit");
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (!response.body) throw new SafeError("Media: empty response");
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw new SafeError("Media: image exceeds 20 MB limit");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function optimizeImage(
  root: string,
  id: string,
  index: number,
  input: Buffer,
): Promise<LocalImage> {
  mediaIdSchema.parse(id);
  if (!Number.isInteger(index) || index < 1 || index > 20)
    throw new SafeError("Unexpected image index");
  const number = String(index).padStart(2, "0");
  const relative = `/media/posts/${id}/${number}`;
  const folder = path.join(root, "public/media/posts", id);
  await mkdir(folder, { recursive: true });
  const large = await sharp(input, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize({
      width: 1600,
      height: 1600,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true });
  const small = await sharp(large.data)
    .resize({ width: 640, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer({ resolveWithObject: true });
  await writeFile(path.join(folder, `${number}.webp`), large.data);
  await writeFile(path.join(folder, `${number}-640.webp`), small.data);
  return {
    src: `${relative}.webp`,
    smallSrc: `${relative}-640.webp`,
    width: large.info.width,
    height: large.info.height,
    smallWidth: small.info.width,
    alt: "Bild zum Instagram-Beitrag; Beschreibung noch prüfen.",
  };
}

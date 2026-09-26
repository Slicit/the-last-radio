import sharp from "sharp";
import { HTTPException } from "hono/http-exception";

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const SIZE = 256;

/** What the first bytes say the file is. The declared type and name are never trusted. */
export function sniffImage(buf: Buffer): "jpeg" | "png" | "webp" | "gif" | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
  const gif = buf.toString("ascii", 0, 6);
  if (gif === "GIF87a" || gif === "GIF89a") return "gif";
  return null;
}

/**
 * Turns an upload into the only thing we ever store or serve: a fresh
 * 256×256 WebP. Re-encoding drops anything smuggled in the original (EXIF
 * with GPS, ICC tricks, polyglot payloads); the pixel cap stops
 * decompression bombs; animations keep their first frame.
 */
export async function processAvatar(buf: Buffer): Promise<Buffer> {
  if (buf.length > AVATAR_MAX_BYTES) throw new HTTPException(413, { message: "That image is over 5 MB" });
  if (!sniffImage(buf)) throw new HTTPException(415, { message: "Use a JPEG, PNG, WebP or GIF image" });
  try {
    return await sharp(buf, { limitInputPixels: 40_000_000, animated: false, failOn: "error" })
      .rotate() // honour the camera's orientation before it's dropped with the metadata
      .resize(SIZE, SIZE, { fit: "cover", position: "attention" })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    throw new HTTPException(422, { message: "That image couldn't be read. Try another one." });
  }
}

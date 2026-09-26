import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { crc32 } from "node:zlib";
import { processAvatar, sniffImage } from "../../src/lib/avatar.js";

const png = (w = 64, h = 48) => sharp({ create: { width: w, height: h, channels: 3, background: "#c33" } }).png().toBuffer();

// specs/features/profile.feature: "Profile photos are handled safely"
describe("Profile photos are handled safely", () => {
  it("judges files by their content", async () => {
    expect(sniffImage(await png())).toBe("png");
    expect(sniffImage(await sharp(await png()).jpeg().toBuffer())).toBe("jpeg");
    expect(sniffImage(await sharp(await png()).webp().toBuffer())).toBe("webp");
    expect(sniffImage(Buffer.from("<svg onload=alert(1)></svg>          "))).toBeNull();
    expect(sniffImage(Buffer.from("%PDF-1.7 ......"))).toBeNull();
  });

  it("re-encodes to a 256×256 WebP", async () => {
    const out = await processAvatar(await png(800, 300));
    const meta = await sharp(out).metadata();
    expect(meta).toMatchObject({ format: "webp", width: 256, height: 256 });
  });

  it("strips camera metadata", async () => {
    const withGps = await sharp(await png(400, 400))
      .withExif({ IFD0: { Make: "SpyCam", Copyright: "secret" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "48/1 51/1 24/1" } })
      .jpeg()
      .toBuffer();
    expect((await sharp(withGps).metadata()).exif).toBeDefined();
    const out = await processAvatar(withGps);
    const meta = await sharp(out).metadata();
    expect(meta.exif).toBeUndefined();
    expect(out.includes(Buffer.from("SpyCam"))).toBe(false);
  });

  it("refuses non-images, oversized files and decompression bombs", async () => {
    await expect(processAvatar(Buffer.from("GIF89a-but-not-really-an-image"))).rejects.toThrow("couldn't be read");
    await expect(processAvatar(Buffer.from("plain text pretending to be a photo"))).rejects.toThrow("JPEG, PNG, WebP or GIF");
    await expect(processAvatar(Buffer.alloc(5 * 1024 * 1024 + 1))).rejects.toThrow("over 5 MB");
    // A decompression bomb: a tiny file whose header claims 20,000 × 20,000 pixels.
    const bomb = Buffer.from(await png(8, 8));
    bomb.writeUInt32BE(20_000, 16);
    bomb.writeUInt32BE(20_000, 20);
    bomb.writeUInt32BE(crc32(bomb.subarray(12, 29)), 29);
    await expect(processAvatar(bomb)).rejects.toThrow("couldn't be read");
  });
});

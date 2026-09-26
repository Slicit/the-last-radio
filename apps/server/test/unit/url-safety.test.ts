import { describe, expect, it } from "vitest";
import { assertPublicUrl, isPrivateAddress } from "../../src/lib/url-safety.js";

// specs/features/adding-songs.feature: "Only public music links are fetched"
describe("Only public music links are fetched", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.10", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"])(
    "%s is private",
    (ip) => expect(isPrivateAddress(ip)).toBe(true),
  );

  it.each(["8.8.8.8", "142.250.74.14", "172.32.0.1", "2a00:1450:4007:80e::200e"])("%s is public", (ip) =>
    expect(isPrivateAddress(ip)).toBe(false),
  );

  it.each([
    ["http://mediamtx:9997/v3/paths/list", "private address"],
    ["http://localhost:3000/", "private address"],
    ["http://radio-box.home:28732/", "private address"],
    ["http://printer.local/", "private address"],
    ["http://10.0.0.5/song.mp3", "private address"],
    ["http://[::1]/", "private address"],
    ["https://user:pw@www.youtube.com/watch?v=x", "credentials"],
    ["ftp://example.com/song.mp3", "Only http(s)"],
    ["not a url", "doesn't look like a link"],
  ])("refuses %s", async (url, message) => {
    await expect(assertPublicUrl(url)).rejects.toThrow(message);
  });

  it("accepts a public IP literal without a DNS lookup", async () => {
    await expect(assertPublicUrl("https://8.8.8.8/")).resolves.toBeUndefined();
  });
});

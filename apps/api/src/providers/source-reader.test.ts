import { describe, it, expect, vi } from "vitest";
import { SafeSourceReader } from "./source-reader";
describe("source reading boundary", () => {
  it("rejects credentials, literal IPs and local addresses before network I/O", async () => {
    let requests = 0;
    const reader = new SafeSourceReader(async () => ["93.184.216.34"], {
      pinned_public_egress: true,
      read: async () => {
        requests++;
        return new Response("text");
      },
    });
    for (const url of [
      "http://example.org",
      "https://127.0.0.1",
      "https://[::1]",
      "https://user:pass@example.org",
      "https://localhost",
      "https://x.internal",
    ])
      expect((await reader.read(url)).status).toBe("inaccessible");
    expect(requests).toBe(0);
  });
  it("rejects a public-looking domain with a private DNS result", async () => {
    const reader = new SafeSourceReader(async () => ["10.0.0.1"], {
      pinned_public_egress: true,
      read: async () => new Response("private"),
    });
    expect((await reader.read("https://example.org")).status).toBe(
      "inaccessible",
    );
  });
  it("checks every redirect and does not follow to a private host", async () => {
    let requests = 0;
    const reader = new SafeSourceReader(async () => ["93.184.216.34"], {
      pinned_public_egress: true,
      read: async () => {
        requests++;
        return new Response(null, {
          status: 302,
          headers: { Location: "https://127.0.0.1/admin" },
        });
      },
    });
    expect((await reader.read("https://example.org")).status).toBe(
      "inaccessible",
    );
    expect(requests).toBe(1);
  });
  it("does not enable arbitrary fetch on an unverified transport", async () => {
    let requests = 0;
    const reader = new SafeSourceReader(async () => ["93.184.216.34"], {
      pinned_public_egress: false,
      read: async () => {
        requests++;
        return new Response("text");
      },
    });
    expect((await reader.read("https://example.org")).status).toBe(
      "unavailable",
    );
    expect(requests).toBe(0);
  });
  it("limits size and treats HTML as inert text", async () => {
    const tooLarge = new SafeSourceReader(async () => ["93.184.216.34"], {
      pinned_public_egress: true,
      read: async () => new Response("x".repeat(1048577)),
    });
    expect((await tooLarge.read("https://example.org")).status).toBe(
      "inaccessible",
    );
    const reader = new SafeSourceReader(async () => ["93.184.216.34"], {
      pinned_public_egress: true,
      read: async () =>
        new Response(
          "<title>Agent</title><script>steal()</script><p>资料正文</p>",
        ),
    });
    expect((await reader.read("https://example.org")).limited_text).toContain(
      "资料正文",
    );
    expect(
      (await reader.read("https://example.org")).limited_text,
    ).not.toContain("steal()");
  });
  it("enforces the deadline even if a transport ignores abort", async () => {
    vi.useFakeTimers();
    try {
      const reader = new SafeSourceReader(async () => ["93.184.216.34"], {
        pinned_public_egress: true,
        read: async () => new Promise<Response>(() => {}),
      });
      const pending = reader.read("https://example.org");
      await vi.advanceTimersByTimeAsync(10001);
      const result = await Promise.race([
        pending,
        Promise.resolve({ status: "still_pending" }),
      ]);
      expect(result.status).toBe("inaccessible");
    } finally {
      vi.useRealTimers();
    }
  });
});

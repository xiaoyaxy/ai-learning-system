import ipaddr from "ipaddr.js";
export type SourceStatus = "accessible" | "inaccessible" | "unavailable";
export interface SourceReadResult {
  status: SourceStatus;
  title: string;
  canonical_url: string;
  fetched_at: string;
  limited_text: string;
  citations: { text: string }[];
}
export interface SourceReader {
  read(url: string): Promise<SourceReadResult>;
}
export interface SourceTransport {
  pinned_public_egress: boolean;
  read(
    url: string,
    options: {
      public_addresses: string[];
      redirect: "manual";
      signal: AbortSignal;
    },
  ): Promise<Response>;
}
export function publicHttpsUrl(raw: string): URL | null {
  try {
    const url = new URL(raw),
      host = url.hostname.replace(/^\[|\]$/g, "");
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443") ||
      ipaddr.isValid(host) ||
      host === "localhost" ||
      !host.includes(".") ||
      /\.(localhost|local|internal|invalid|test)$/i.test(host)
    )
      return null;
    return url;
  } catch {
    return null;
  }
}
function publicAddress(value: string) {
  try {
    return ipaddr.process(value).range() === "unicast";
  } catch {
    return false;
  }
}
const empty = (url: string, status: SourceStatus): SourceReadResult => ({
  status,
  title: "",
  canonical_url: url,
  fetched_at: new Date().toISOString(),
  limited_text: "",
  citations: [],
});
export class SafeSourceReader implements SourceReader {
  constructor(
    private resolve: (hostname: string) => Promise<string[]>,
    private transport: SourceTransport,
  ) {}
  async read(raw: string): Promise<SourceReadResult> {
    if (!publicHttpsUrl(raw)) return empty(raw, "inaccessible");
    if (!this.transport.pinned_public_egress) return empty(raw, "unavailable");
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<SourceReadResult>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve(empty(raw, "inaccessible"));
      }, 10000);
    });
    try {
      return await Promise.race([
        this.collect(raw, controller.signal),
        deadline,
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  private async collect(
    raw: string,
    signal: AbortSignal,
  ): Promise<SourceReadResult> {
    try {
      let target = raw;
      for (let redirects = 0; redirects <= 3; redirects++) {
        if (signal.aborted) return empty(raw, "inaccessible");
        const url = publicHttpsUrl(target);
        if (!url) return empty(raw, "inaccessible");
        const addresses = await this.resolve(url.hostname);
        if (
          signal.aborted ||
          !addresses.length ||
          !addresses.every(publicAddress)
        )
          return empty(raw, "inaccessible");
        const response = await this.transport.read(url.href, {
          public_addresses: addresses,
          redirect: "manual",
          signal,
        });
        if (signal.aborted) return empty(raw, "inaccessible");
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get("Location");
          if (!location || redirects === 3) return empty(raw, "inaccessible");
          target = new URL(location, url).href;
          continue;
        }
        if (!response.ok) return empty(raw, "inaccessible");
        const type = response.headers.get("Content-Type") ?? "text/plain";
        if (!/text\/|application\/xhtml\+xml/i.test(type))
          return empty(raw, "inaccessible");
        let size = 0,
          text = "",
          decoder = new TextDecoder(),
          reader = response.body?.getReader();
        if (reader)
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (signal.aborted) {
              await reader.cancel();
              return empty(raw, "inaccessible");
            }
            size += value.byteLength;
            if (size > 1048576) {
              await reader.cancel();
              return empty(raw, "inaccessible");
            }
            text += decoder.decode(value, { stream: true });
          }
        text += decoder.decode();
        const title =
          text.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? url.hostname;
        const plain = text
          .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
          .replace(/<[^>]*>/g, " ")
          .replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/\s+/g, " ")
          .trim();
        if (!plain) return empty(raw, "inaccessible");
        return {
          status: "accessible",
          title,
          canonical_url: url.href,
          fetched_at: new Date().toISOString(),
          limited_text: plain.slice(0, 8000),
          citations: [],
        };
      }
      return empty(raw, "inaccessible");
    } catch {
      return empty(raw, "inaccessible");
    }
  }
}
/** Arbitrary URL reads require a verified transport that pins the validated address and TLS host. */
export class UnconfiguredSourceReader implements SourceReader {
  async read(url: string): Promise<SourceReadResult> {
    return empty(url, "unavailable");
  }
}

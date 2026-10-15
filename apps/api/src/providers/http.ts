import { ApiError } from "../http/errors";
export interface ProviderOptions {
  fetch?: typeof fetch;
  timeout_ms?: number;
}
export async function withDeadline<T>(
  call: (signal: AbortSignal) => Promise<T>,
  timeoutMs = 30000,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ApiError("OUTCOME_UNKNOWN", 409, true));
    }, timeoutMs);
  });
  try {
    return await Promise.race([call(controller.signal), deadline]);
  } finally {
    clearTimeout(timer!);
  }
}
export async function providerJson(
  url: string,
  body: unknown,
  key: string,
  options: ProviderOptions = {},
) {
  return withDeadline(async (signal) => {
    let response: Response;
    try {
      response = await (options.fetch ?? fetch)(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(body),
        redirect: "manual",
        signal,
      });
    } catch {
      throw new ApiError("OUTCOME_UNKNOWN", 409, true);
    }
    if (response.status === 429)
      throw new ApiError("QUOTA_EXCEEDED", 429, true);
    if ([401, 403].includes(response.status))
      throw new ApiError("PROVIDER_AUTH_FAILED", 502);
    if (!response.ok)
      throw new ApiError("PROVIDER_UNAVAILABLE", 502, response.status >= 500);
    let bytes = 0;
    const chunks: Uint8Array[] = [],
      reader = response.body?.getReader();
    if (reader)
      while (true) {
        const value = await reader.read();
        if (value.done) break;
        bytes += value.value.length;
        if (bytes > 1024 * 1024) {
          await reader.cancel();
          throw new ApiError("MODEL_INVALID_RESULT", 422);
        }
        chunks.push(value.value);
      }
    if (signal.aborted) throw new ApiError("OUTCOME_UNKNOWN", 409, true);
    const all = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      all.set(chunk, offset);
      offset += chunk.length;
    }
    let data: unknown;
    try {
      data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(all));
    } catch {
      throw new ApiError("MODEL_INVALID_RESULT", 422);
    }
    return {
      data,
      request_id: response.headers.get("x-request-id") ?? undefined,
    };
  }, options.timeout_ms ?? 30000);
}

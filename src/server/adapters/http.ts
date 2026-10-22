// Minimal JSON-over-HTTP helper shared by adapters. Injected fetch keeps
// adapters testable without network access.

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export class AdapterHttpError extends Error {
  constructor(
    readonly service: string,
    readonly status: number,
    readonly detail: string,
  ) {
    super(`${service} request failed with HTTP ${status}: ${detail.slice(0, 300)}`);
    this.name = "AdapterHttpError";
  }
}

export async function requestJson<T>(
  fetchImpl: FetchLike,
  service: string,
  url: string,
  init: { method: string; headers?: Record<string, string>; body?: unknown },
): Promise<T> {
  const res = await fetchImpl(url, {
    method: init.method,
    headers: { "content-type": "application/json", accept: "application/json", ...init.headers },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  if (!res.ok) throw new AdapterHttpError(service, res.status, text);
  return (text ? JSON.parse(text) : {}) as T;
}

export const defaultFetch = (): FetchLike => globalThis.fetch as unknown as FetchLike;

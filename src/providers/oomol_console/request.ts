import { optionalRecord, optionalString } from "../../core/cast.ts";
import { createProviderTimeout, providerUserAgent, ProviderRequestError } from "../provider-runtime.ts";

export interface OomolConsoleEndpoints {
  connector: string;
  insight: string;
  relationControl: string;
}

export type OomolConsoleEndpointName = keyof OomolConsoleEndpoints;

export const defaultEndpoints: OomolConsoleEndpoints = {
  connector: "https://connector.oomol.com",
  insight: "https://insight.oomol.com",
  relationControl: "https://relation-control.oomol.com",
};

export async function requestOomolConsole(input: {
  endpoints?: OomolConsoleEndpoints;
  endpoint: OomolConsoleEndpointName;
  path: string;
  accessToken: string;
  fetcher: typeof fetch;
  signal?: AbortSignal;
  method?: "GET" | "POST";
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  teamId?: string;
}): Promise<unknown> {
  const endpoints = input.endpoints ?? defaultEndpoints;
  const url = new URL(input.path, `${endpoints[input.endpoint]}/`);
  for (const [name, value] of Object.entries(input.query ?? {})) {
    if (value != null) url.searchParams.set(name, String(value));
  }
  const headers = new Headers({
    accept: "application/json",
    authorization: `Bearer ${input.accessToken}`,
    "user-agent": providerUserAgent,
  });
  if (input.endpoint === "connector" && input.teamId) headers.set("x-oo-team-id", input.teamId);
  if (input.body !== undefined) headers.set("content-type", "application/json");
  const timeout = createProviderTimeout(input.signal, 15_000);
  try {
    let response: Response;
    try {
      response = await input.fetcher(url, {
        method: input.method ?? "GET",
        headers,
        body: input.body === undefined ? undefined : JSON.stringify(input.body),
        signal: timeout.signal,
      });
    } catch (error) {
      if (timeout.didTimeout()) throw new ProviderRequestError(504, "OOMOL Console request timed out");
      throw new ProviderRequestError(
        502,
        `OOMOL Console request failed: ${sanitize(
          error instanceof Error ? error.message : "network error",
          input.accessToken,
        )}`,
        error,
      );
    }
    const text = response.status === 204 ? "" : await response.text();
    let payload: unknown = undefined;
    if (text.trim()) {
      try {
        payload = JSON.parse(text) as unknown;
      } catch {
        payload = text;
      }
    }
    if (!response.ok) throw mapError(response.status, payload, input.accessToken);
    const record = optionalRecord(payload);
    return record?.success === true && Object.hasOwn(record, "data") ? record.data : payload;
  } finally {
    timeout.cleanup();
  }
}

function mapError(status: number, payload: unknown, accessToken: string): ProviderRequestError {
  const record = optionalRecord(payload);
  const message = sanitize(
    (typeof payload === "string" ? payload.trim() : undefined) ??
      optionalString(record?.errorMessage) ??
      optionalString(record?.message) ??
      optionalString(record?.detail) ??
      optionalString(record?.error) ??
      optionalString(record?.code) ??
      `OOMOL Console request failed with status ${status}`,
    accessToken,
  );
  if (status === 401 || status === 403 || status === 429) {
    return new ProviderRequestError(status, message);
  }
  return new ProviderRequestError(status >= 400 && status < 500 ? 400 : 502, message);
}

function sanitize(value: string, accessToken: string): string {
  return accessToken ? value.replaceAll(accessToken, "[REDACTED]") : value;
}

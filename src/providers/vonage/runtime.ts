import type { CredentialValidationResult } from "../../core/types.ts";
import type { ProviderFetch } from "../provider-runtime.ts";

import { Buffer } from "node:buffer";
import { optionalBoolean, optionalInteger, optionalRecord, optionalString, requiredString } from "../../core/cast.ts";
import {
  createProviderTimeout,
  isAbortLikeError,
  ProviderRequestError,
  providerUserAgent,
  readProviderJsonBody,
} from "../provider-runtime.ts";

export const vonageApiBaseUrl = "https://rest.nexmo.com";
const vonageRequestTimeoutMs = 30_000;
const invalidInputSmsStatuses = new Set(["2", "3", "6", "7", "12", "15", "17", "22", "23", "29", "33"]);

export interface VonageContext {
  apiKey: string;
  apiSecret: string;
  fetcher: ProviderFetch;
  signal?: AbortSignal;
}

interface VonageRequestInput {
  path: string;
  context: VonageContext;
  phase: "validate" | "execute";
  method?: "GET" | "POST";
  body?: URLSearchParams;
}

type VonageHandler = (input: Record<string, unknown>, context: VonageContext) => Promise<unknown>;

export const vonageActionHandlers: Record<string, VonageHandler> = {
  async get_balance(_input, context) {
    return normalizeBalance(await requestVonage({ path: "/account/get-balance", context, phase: "execute" }));
  },
  async send_sms(input, context) {
    const body = new URLSearchParams();
    appendRequiredFormField(body, "from", input.from);
    appendRequiredFormField(body, "to", input.to);
    appendRequiredFormField(body, "text", input.text);
    appendOptionalFormField(body, "type", optionalString(input.type));
    appendOptionalFormField(body, "ttl", optionalInteger(input.ttl));
    appendOptionalFormField(body, "status-report-req", optionalBoolean(input.statusReportRequired));
    appendOptionalFormField(body, "callback", optionalString(input.callback));
    appendOptionalFormField(body, "client-ref", optionalString(input.clientRef));
    return normalizeSms(await requestVonage({ path: "/sms/json", method: "POST", body, context, phase: "execute" }));
  },
};

export function createVonageContext(
  values: Record<string, string>,
  fetcher: ProviderFetch,
  signal?: AbortSignal,
): VonageContext {
  return {
    apiKey: requiredString(values.apiKey, "apiKey", invalidInput),
    apiSecret: requiredString(values.apiSecret, "apiSecret", invalidInput),
    fetcher,
    signal,
  };
}

export async function validateVonageCredential(
  values: Record<string, string>,
  fetcher: ProviderFetch,
  signal?: AbortSignal,
): Promise<CredentialValidationResult> {
  const context = createVonageContext(values, fetcher, signal);
  const balance = normalizeBalance(await requestVonage({ path: "/account/get-balance", context, phase: "validate" }));
  return {
    profile: { accountId: `vonage:${context.apiKey}`, displayName: `Vonage ${context.apiKey}` },
    grantedScopes: [],
    metadata: {
      apiBaseUrl: vonageApiBaseUrl,
      validationEndpoint: "/account/get-balance",
      balanceAutoReload: balance.autoReload,
    },
  };
}

async function requestVonage(input: VonageRequestInput): Promise<unknown> {
  const timeout = createProviderTimeout(input.context.signal, vonageRequestTimeoutMs);
  try {
    const response = await input.context.fetcher(`${vonageApiBaseUrl}${input.path}`, {
      method: input.method ?? "GET",
      headers: {
        accept: "application/json",
        authorization: `Basic ${Buffer.from(`${input.context.apiKey}:${input.context.apiSecret}`).toString("base64")}`,
        ...(input.body ? { "content-type": "application/x-www-form-urlencoded" } : {}),
        "user-agent": providerUserAgent,
      },
      body: input.body,
      signal: timeout.signal,
    });
    const payload = await readProviderJsonBody(response, {
      emptyBody: {},
      invalidJsonMessage: "Vonage returned invalid JSON",
    });
    if (!response.ok) throw mapHttpError(response, payload, input.phase);
    return payload;
  } catch (error) {
    if (error instanceof ProviderRequestError) throw error;
    if (timeout.didTimeout() || isAbortLikeError(error)) {
      throw new ProviderRequestError(504, "Vonage request timed out");
    }
    throw new ProviderRequestError(
      502,
      error instanceof Error ? `Vonage request failed: ${error.message}` : "Vonage request failed",
    );
  } finally {
    timeout.cleanup();
  }
}

function mapHttpError(response: Response, payload: unknown, phase: "validate" | "execute"): ProviderRequestError {
  const message = readErrorMessage(payload) ?? `Vonage request failed (${response.status})`;
  if (response.status === 401 || response.status === 403) {
    return new ProviderRequestError(phase === "validate" ? 400 : 401, message, payload);
  }
  if (response.status === 429) return new ProviderRequestError(429, message, payload);
  return new ProviderRequestError(response.status >= 500 ? 502 : 400, message, payload);
}

function normalizeBalance(payload: unknown): { value: number; autoReload: boolean } {
  const record = requireResponseRecord(payload, "Vonage balance response");
  if (typeof record.value !== "number" || typeof record.autoReload !== "boolean") {
    throw new ProviderRequestError(502, "Vonage returned an invalid balance response", payload);
  }
  return { value: record.value, autoReload: record.autoReload };
}

function normalizeSms(payload: unknown): unknown {
  const record = requireResponseRecord(payload, "Vonage SMS response");
  const messages = Array.isArray(record.messages) ? record.messages : [];
  if (messages.length === 0) throw new ProviderRequestError(502, "Vonage returned no SMS submission result");
  const normalizedMessages = messages.map((item) => {
    const message = requireResponseRecord(item, "Vonage SMS result");
    const status = requireResponseString(message.status, "status");
    if (status !== "0") throw mapSmsError(status, optionalString(message["error-text"]));
    return {
      to: requireResponseString(message.to, "to"),
      messageId: requireResponseString(message["message-id"], "message-id"),
      status,
      remainingBalance: optionalString(message["remaining-balance"]) ?? null,
      messagePrice: optionalString(message["message-price"]) ?? null,
      network: optionalString(message.network) ?? null,
      clientRef: optionalString(message["client-ref"]) ?? null,
    };
  });
  const declaredCount = Number.parseInt(optionalString(record["message-count"]) ?? "", 10);
  return {
    messageCount: Number.isFinite(declaredCount) ? declaredCount : normalizedMessages.length,
    messages: normalizedMessages,
  };
}

function mapSmsError(status: string, message?: string): ProviderRequestError {
  const text = message ?? `Vonage rejected the SMS with status ${status}`;
  if (status === "1" || status === "9" || status === "10") return new ProviderRequestError(429, text);
  if (["4", "8", "11", "14", "32"].includes(status)) return new ProviderRequestError(401, text);
  if (invalidInputSmsStatuses.has(status)) return new ProviderRequestError(400, text);
  return new ProviderRequestError(502, text);
}

function requireResponseRecord(value: unknown, label: string): Record<string, unknown> {
  const record = optionalRecord(value);
  if (!record) throw new ProviderRequestError(502, `${label} must be an object`, value);
  return record;
}

function requireResponseString(value: unknown, fieldName: string): string {
  const text = optionalString(value);
  if (!text) throw new ProviderRequestError(502, `Vonage response is missing ${fieldName}`);
  return text;
}

function readErrorMessage(payload: unknown): string | undefined {
  const record = optionalRecord(payload);
  return record
    ? (optionalString(record.detail) ??
        optionalString(record.title) ??
        optionalString(record.message) ??
        optionalString(record["error-text"]))
    : undefined;
}

function appendRequiredFormField(body: URLSearchParams, key: string, value: unknown): void {
  body.set(key, requiredString(value, key, invalidInput));
}

function appendOptionalFormField(
  body: URLSearchParams,
  key: string,
  value: string | number | boolean | undefined,
): void {
  if (value !== undefined) body.set(key, String(value));
}

function invalidInput(message: string): ProviderRequestError {
  return new ProviderRequestError(400, message);
}

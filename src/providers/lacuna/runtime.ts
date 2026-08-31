import type { ProviderActionHandlers, ProviderFetch, ProviderRuntimeHandler } from "../provider-runtime.ts";

import { optionalBoolean, optionalInteger, optionalRecord, optionalString, requiredString } from "../../core/cast.ts";
import {
  ProviderRequestError,
  providerInputError,
  providerResponseError,
  providerUserAgent,
  readProviderJsonBody,
  runProviderRequest,
} from "../provider-runtime.ts";

export const lacunaBaseUrl = "https://lacuna.tiptreesystems.com";
const retryableStatuses = new Set([429, 502, 503, 504]);
const maxRetries = 2;
const maxResponseBytes = 8 * 1024 * 1024;

const searchTypeAliases: Record<string, string> = {
  all: "all",
  paper: "paper",
  papers: "paper",
  cluster: "cluster",
  clusters: "cluster",
  direction: "cluster",
  directions: "cluster",
  author: "author",
  authors: "author",
  institution: "institution",
  institutions: "institution",
  venue: "venue",
  venues: "venue",
  hypothesis: "hypothesis",
  hypotheses: "hypothesis",
  proposal: "hypothesis",
  proposals: "hypothesis",
};
const rankingAliases: Record<string, string> = {
  default: "default",
  lexical: "default",
  semantic: "semantic",
  bm25: "bm25_title_abstract",
  bm25_title_abstract: "bm25_title_abstract",
};
const allowedFields = new Set(["title", "abstract", "summary", "concepts", "name", "top_names", "venue"]);
const markdownPathPattern =
  /\/(author|cluster|direction|figures|hypothesis|institution|node|paper|pdf|venue)\/[^\s)\]"']+/g;

export interface LacunaActionContext {
  fetcher: ProviderFetch;
  signal?: AbortSignal;
}

export const lacunaActionHandlers: ProviderActionHandlers<"lacuna", ProviderRuntimeHandler<LacunaActionContext>> = {
  async search(input, context): Promise<unknown> {
    const query = requiredString(input.query, "query", providerInputError);
    const searchType = readAlias(input.searchType, "searchType", searchTypeAliases, "all");
    const rankingProfile = readAlias(input.rankingProfile, "rankingProfile", rankingAliases, "default");
    const sort = readEnum(input.sort, "sort", ["relevance", "year_desc", "year_asc"], "relevance");
    const fields = optionalString(input.fields);
    validateSearchOptions(searchType, rankingProfile, sort, fields);

    const limit = readBoundedInteger(input.limit, "limit", 1, 50, 10);
    const offset = readBoundedInteger(input.offset, "offset", 0, Number.MAX_SAFE_INTEGER, 0);
    const params = new URLSearchParams({
      q: query,
      type: searchType,
      limit: String(limit),
      offset: String(offset),
      sort,
      ranking_profile: rankingProfile,
    });
    setOptionalParam(params, "date_from", input.dateFrom);
    setOptionalParam(params, "date_to", input.dateTo);
    setOptionalParam(params, "venue", input.venue);
    if (fields) params.set("fields", fields);
    return requestLacunaJson("/api/v1/search", params, context);
  },

  async get_paper(input, context): Promise<unknown> {
    const paperId = readPaperId(input.paperIdOrUrl);
    const view = readEnum(
      input.view,
      "view",
      ["context", "full", "preview", "blog", "figures", "concepts", "neighbors"],
      "context",
    );
    const path =
      view === "context"
        ? `/api/v1/context/paper/${encodeURIComponent(paperId)}`
        : view === "full"
          ? `/api/v1/papers/${encodeURIComponent(paperId)}`
          : `/api/v1/papers/${encodeURIComponent(paperId)}/${view}`;
    const params = new URLSearchParams();
    if (view === "context") {
      params.set("view", "compact");
      const figureLimit = readOptionalBoundedInteger(input.figureLimit, "figureLimit", 0, Number.MAX_SAFE_INTEGER);
      if (figureLimit !== undefined) params.set("figure_limit", String(figureLimit));
    }
    return withStableId(await requestLacunaJson(path, params, context), "artifact_id", paperId);
  },

  async get_direction(input, context): Promise<unknown> {
    const directionId = readDirectionId(input.directionIdOrUrl);
    const view = readEnum(input.view, "view", ["context", "full"], "context");
    const path = view === "context" ? `/api/v1/context/direction/${directionId}` : `/api/v1/clusters/${directionId}`;
    const params = view === "context" ? new URLSearchParams({ view: "compact" }) : new URLSearchParams();
    return withStableId(await requestLacunaJson(path, params, context), "cluster_id", directionId);
  },

  async get_direction_papers(input, context): Promise<unknown> {
    const directionId = readDirectionId(input.directionIdOrUrl);
    const page = readBoundedInteger(input.page, "page", 1, Number.MAX_SAFE_INTEGER, 1);
    const limit = readBoundedInteger(input.limit, "limit", 1, 100, 24);
    const view = readEnum(input.view, "view", ["compact", "full"], "compact");
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
      view: view === "full" ? "complete" : "compact",
    });
    const payload = await requestLacunaJson(`/api/v1/clusters/${directionId}/papers`, params, context);
    return withStableId(payload, "cluster_id", directionId);
  },

  async get_author_context(input, context): Promise<unknown> {
    const authorId = readRouteId(input.authorIdOrUrl, "authorIdOrUrl", "author");
    const view = readEnum(input.view, "view", ["context", "full"], "context");
    const includeNeighbors = optionalBoolean(input.includeNeighbors) ?? false;
    const params = new URLSearchParams({ include_neighbors: String(includeNeighbors) });
    if (view === "context") params.set("view", "compact");
    const payload = await requestLacunaJson(`/api/v1/context/author/${encodeURIComponent(authorId)}`, params, context);
    return withStableId(payload, "author_id", authorId);
  },

  async get_hypothesis(input, context): Promise<unknown> {
    const hypothesisId = readHypothesisId(input.hypothesisIdOrUrl);
    const view = readEnum(input.view, "view", ["context", "full"], "context");
    const path =
      view === "context" ? `/api/v1/context/hypothesis/${hypothesisId}` : `/api/v1/hypotheses/${hypothesisId}`;
    const params = view === "context" ? new URLSearchParams({ view: "compact" }) : new URLSearchParams();
    return withStableId(await requestLacunaJson(path, params, context), "hypothesis_id", hypothesisId);
  },
};

async function requestLacunaJson(
  path: string,
  params: URLSearchParams,
  context: LacunaActionContext,
): Promise<Record<string, unknown>> {
  return runProviderRequest({ label: "Lacuna", signal: context.signal }, async (signal) => {
    const url = new URL(path, lacunaBaseUrl);
    url.search = params.toString();

    for (let attempt = 0; ; attempt += 1) {
      const response = await context.fetcher(url, {
        headers: { accept: "application/json", "user-agent": providerUserAgent },
        signal,
      });
      if (retryableStatuses.has(response.status) && attempt < maxRetries) {
        await response.body?.cancel();
        await waitForRetry(response.headers.get("retry-after"), attempt, signal);
        continue;
      }

      const payload = await readProviderJsonBody(response, {
        emptyBody: null,
        invalidJsonMessage: "Lacuna returned invalid JSON.",
        maxBytes: maxResponseBytes,
      });
      if (!response.ok) {
        throw new ProviderRequestError(
          response.status >= 500 ? 502 : response.status,
          readErrorMessage(payload) ?? `Lacuna request failed with HTTP ${response.status}.`,
          payload,
        );
      }
      const record = optionalRecord(payload);
      if (!record) throw providerResponseError("Lacuna returned an invalid response object.");
      return normalizeLacunaRecord(record);
    }
  });
}

function validateSearchOptions(searchType: string, rankingProfile: string, sort: string, fields?: string): void {
  if (rankingProfile === "semantic") {
    if (searchType !== "all" && searchType !== "paper") {
      throw providerInputError("semantic ranking supports only paper or all searches.");
    }
    if (fields) throw providerInputError("semantic ranking cannot be combined with fields.");
    if (sort !== "relevance") throw providerInputError("semantic ranking cannot be combined with year sorting.");
  }
  if (rankingProfile === "bm25_title_abstract" && (searchType === "author" || searchType === "institution")) {
    throw providerInputError("BM25 title/abstract ranking does not support author or institution searches.");
  }
  if (!fields) return;
  for (const weightedField of fields.split(",")) {
    const [field, rawWeight, ...extra] = weightedField.trim().split("^");
    if (!field || extra.length > 0 || !allowedFields.has(field)) {
      throw providerInputError(`Unsupported Lacuna search field: ${weightedField.trim() || "empty field"}.`);
    }
    if (rawWeight !== undefined) {
      const weight = Number(rawWeight);
      if (!Number.isFinite(weight) || weight <= 0 || weight > 100) {
        throw providerInputError(
          `Search field weight must be greater than 0 and at most 100: ${weightedField.trim()}.`,
        );
      }
    }
  }
}

function readPaperId(value: unknown): string {
  const input = requiredString(value, "paperIdOrUrl", providerInputError);
  const candidate = readRouteCandidate(input, "paperIdOrUrl");
  const match = candidate.match(/art_[A-Za-z0-9_-]+/);
  if (!match) throw providerInputError("paperIdOrUrl must contain a Lacuna art_ paper identifier.");
  return match[0];
}

function readDirectionId(value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  const input = requiredString(value, "directionIdOrUrl", providerInputError);
  const candidate = readRouteCandidate(input, "directionIdOrUrl");
  const match = candidate.match(/(?:^|\/)(\d+)\/?$/);
  const directionId = match ? Number(match[1]) : Number(candidate);
  if (!Number.isSafeInteger(directionId) || directionId <= 0) {
    throw providerInputError("directionIdOrUrl must contain a positive Lacuna direction identifier.");
  }
  return directionId;
}

function readHypothesisId(value: unknown): string {
  const input = requiredString(value, "hypothesisIdOrUrl", providerInputError);
  const candidate = readRouteCandidate(input, "hypothesisIdOrUrl");
  const match = candidate.match(/(?:^|\/)([0-9a-fA-F]{16})\/?$/);
  if (!match) throw providerInputError("hypothesisIdOrUrl must contain a 16-character Lacuna hypothesis ID.");
  return match[1].toLowerCase();
}

function readRouteId(value: unknown, fieldName: string, route: string): string {
  const input = requiredString(value, fieldName, providerInputError);
  const candidate = readRouteCandidate(input, fieldName);
  if (!candidate.includes("/")) return candidate;
  const parts = candidate.split("/").filter(Boolean);
  const routeIndex = parts.indexOf(route);
  if (routeIndex < 0 || routeIndex === parts.length - 1) {
    throw providerInputError(`${fieldName} must be a Lacuna ${route} ID or URL.`);
  }
  return decodeURIComponent(parts.at(-1) ?? "");
}

function readRouteCandidate(input: string, fieldName: string): string {
  if (!input.startsWith("/") && !/^[a-z][a-z\d+.-]*:/i.test(input)) return input;
  let url: URL;
  try {
    url = new URL(input, lacunaBaseUrl);
  } catch {
    throw providerInputError(`${fieldName} must be a valid Lacuna ID or URL.`);
  }
  if (url.origin !== lacunaBaseUrl) throw providerInputError(`${fieldName} must use ${lacunaBaseUrl}.`);
  return decodeURIComponent(url.pathname);
}

function readAlias(value: unknown, fieldName: string, aliases: Record<string, string>, fallback: string): string {
  const raw = optionalString(value)?.toLowerCase() ?? fallback;
  const normalized = aliases[raw];
  if (!normalized) throw providerInputError(`${fieldName} has an unsupported value: ${raw}.`);
  return normalized;
}

function readEnum<T extends string>(value: unknown, fieldName: string, allowed: readonly T[], fallback: T): T {
  const raw = optionalString(value) ?? fallback;
  if (!allowed.includes(raw as T)) throw providerInputError(`${fieldName} has an unsupported value: ${raw}.`);
  return raw as T;
}

function readBoundedInteger(value: unknown, fieldName: string, min: number, max: number, fallback: number): number {
  return readOptionalBoundedInteger(value, fieldName, min, max) ?? fallback;
}

function readOptionalBoundedInteger(value: unknown, fieldName: string, min: number, max: number): number | undefined {
  if (value === undefined) return undefined;
  const number = optionalInteger(value);
  if (number === undefined || number < min || number > max) {
    throw providerInputError(`${fieldName} must be an integer between ${min} and ${max}.`);
  }
  return number;
}

function setOptionalParam(params: URLSearchParams, name: string, value: unknown): void {
  const text = optionalString(value);
  if (text) params.set(name, text);
}

function withStableId(
  payload: Record<string, unknown>,
  fieldName: string,
  value: string | number,
): Record<string, unknown> {
  return { ...payload, [fieldName]: value };
}

function normalizeLacunaRecord(record: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === "_mcp_meta") continue;
    output[key] = normalizeLacunaValue(value, key);
  }
  return output;
}

function normalizeLacunaValue(value: unknown, key: string): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeLacunaValue(item, key));
  const record = optionalRecord(value);
  if (record) return normalizeLacunaRecord(record);
  if (typeof value !== "string") return value;
  if ((key === "url" || key.endsWith("_url")) && value.startsWith("/")) {
    return new URL(value, lacunaBaseUrl).toString();
  }
  if (
    ["article_markdown", "content", "description", "markdown", "profile_markdown", "summary_markdown"].includes(key)
  ) {
    return value.replace(markdownPathPattern, (path) => new URL(path, lacunaBaseUrl).toString());
  }
  return value;
}

function readErrorMessage(payload: unknown): string | undefined {
  const record = optionalRecord(payload);
  if (!record) return optionalString(payload);
  return optionalString(record.detail) ?? optionalString(record.message) ?? optionalString(record.error);
}

async function waitForRetry(retryAfter: string | null, attempt: number, signal: AbortSignal): Promise<void> {
  const retryAfterMs = readRetryAfterMs(retryAfter);
  const delayMs = retryAfterMs ?? 500 * 2 ** attempt;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, delayMs);
    const abort = (): void => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    };
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

function readRetryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30_000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.min(Math.max(date - Date.now(), 0), 30_000);
}

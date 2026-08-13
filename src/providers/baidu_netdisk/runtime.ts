import { compactObject, optionalInteger, optionalString } from "../../core/cast.ts";
import { ProviderRequestError } from "../provider-runtime.ts";

const baiduPanBaseUrl = "https://pan.baidu.com";
const losslessIntegerKeys = new Set(["fs_id", "fsid", "pid", "uk", "request_id", "cursor"]);

type BaiduRequestPhase = "read" | "write";

interface BaiduNetdiskRequestContext {
  accessToken: string;
  fetcher: typeof fetch;
  signal?: AbortSignal;
}

export interface BaiduNetdiskAccount {
  accountId: string;
  accountLabel: string;
  avatarUrl: string | null;
  membership: "free" | "vip" | "svip" | null;
  providerMetadata: Record<string, unknown>;
}

export function parseBaiduNetdiskJson(
  text: string,
  message = "baidu_netdisk returned invalid JSON",
): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(stringifyBaiduLosslessIntegers(text));
  } catch {
    throw new ProviderRequestError(502, message);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProviderRequestError(502, message);
  }
  return value as Record<string, unknown>;
}

export async function fetchBaiduNetdiskAccount(
  accessToken: string,
  fetcher: typeof fetch,
): Promise<BaiduNetdiskAccount> {
  const url = new URL("/rest/2.0/xpan/nas", baiduPanBaseUrl);
  url.searchParams.set("method", "uinfo");
  url.searchParams.set("vip_version", "v2");
  const payload = await requestBaiduNetdiskApi(url, accessToken, fetcher, "read");
  const accountId = requireLosslessId(payload.uk, "uk");
  const netdiskName = optionalString(payload.netdisk_name);
  const baiduName = optionalString(payload.baidu_name);
  return {
    accountId,
    accountLabel: netdiskName ?? baiduName ?? accountId,
    avatarUrl: optionalString(payload.avatar_url) ?? null,
    membership: normalizeMembership(payload.vip_type),
    providerMetadata: compactObject({ uk: accountId, netdiskName, baiduName }),
  };
}

export async function getBaiduNetdiskQuota(context: BaiduNetdiskRequestContext): Promise<Record<string, unknown>> {
  const url = new URL("/api/quota", baiduPanBaseUrl);
  url.searchParams.set("checkfree", "1");
  url.searchParams.set("checkexpire", "1");
  const payload = await requestBaiduNetdiskApi(url, context.accessToken, context.fetcher, "read", {
    signal: context.signal,
  });
  const totalBytes = requireInteger(payload.total, "total");
  const usedBytes = requireInteger(payload.used, "used");
  return {
    totalBytes,
    usedBytes,
    remainingBytes: Math.max(totalBytes - usedBytes, 0),
    freeQuotaBytes: requireInteger(payload.free, "free"),
    expiresWithinSevenDays: payload.expire === true,
  };
}

export function normalizeBaiduNetdiskError(
  errno: number | undefined,
  status: number,
  requestId: unknown,
  phase: BaiduRequestPhase,
): ProviderRequestError {
  const details = compactObject({
    providerCode: errno,
    requestId: typeof requestId === "string" ? requestId : undefined,
  });
  if (status === 429 || errno === 20012 || errno === 31034)
    return new ProviderRequestError(429, "baidu_netdisk rate limit exceeded", details);
  if (errno === -6 || errno === 31045)
    return new ProviderRequestError(401, "baidu_netdisk credential expired", details);
  if (errno === 31024 || (errno === -7 && phase === "read"))
    return new ProviderRequestError(403, "baidu_netdisk permission is missing", details);
  if (errno === 20013 || errno === 20015)
    return new ProviderRequestError(503, "baidu_netdisk application permission is not configured", details);
  if (errno === 20011)
    return new ProviderRequestError(503, "baidu_netdisk test application user limit was reached", details);
  if ([2, 31023, 31062, 31064, 31364, 31365].includes(errno ?? Number.NaN) || (errno === -7 && phase === "write"))
    return new ProviderRequestError(400, "baidu_netdisk rejected the input", details);
  if (errno === -8 || errno === 31061)
    return new ProviderRequestError(409, "baidu_netdisk target already exists", details);
  if (errno === -3 || errno === -9 || errno === 31066)
    return new ProviderRequestError(404, "baidu_netdisk item was not found", details);
  if (errno === -10) return new ProviderRequestError(507, "baidu_netdisk storage is full", details);
  if (errno === 111)
    return new ProviderRequestError(409, "baidu_netdisk has a conflicting file management task", details);
  return new ProviderRequestError(502, "baidu_netdisk request failed", details);
}

async function requestBaiduNetdiskApi(
  url: URL,
  accessToken: string,
  fetcher: typeof fetch,
  phase: BaiduRequestPhase,
  init: RequestInit = {},
): Promise<Record<string, unknown>> {
  url.searchParams.set("access_token", accessToken);
  let response: Response;
  try {
    response = await fetcher(url, {
      ...init,
      headers: {
        "user-agent": "pan.baidu.com",
        accept: "application/json",
        ...Object.fromEntries(new Headers(init.headers).entries()),
      },
    });
  } catch {
    throw new ProviderRequestError(502, "baidu_netdisk request failed");
  }
  const payload = parseBaiduNetdiskJson(await response.text());
  const errno = optionalInteger(payload.errno ?? payload.error_no ?? payload.error_code);
  if (!response.ok || (errno != null && errno !== 0)) {
    throw normalizeBaiduNetdiskError(errno, response.status, payload.request_id, phase);
  }
  return payload;
}

function stringifyBaiduLosslessIntegers(text: string): string {
  const ranges: Array<[number, number]> = [];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '"') continue;
    const keyStart = index;
    const keyEnd = findJsonStringEnd(text, keyStart + 1);
    if (keyEnd < 0) return text;
    index = keyEnd;
    const colonIndex = skipJsonWhitespace(text, keyEnd + 1);
    if (text[colonIndex] !== ":") continue;
    let key: unknown;
    try {
      key = JSON.parse(text.slice(keyStart, keyEnd + 1));
    } catch {
      return text;
    }
    if (typeof key !== "string" || !losslessIntegerKeys.has(key)) continue;
    const valueStart = skipJsonWhitespace(text, colonIndex + 1);
    let valueEnd = valueStart;
    while (isDecimalDigit(text[valueEnd])) valueEnd += 1;
    if (
      valueEnd === valueStart ||
      (text[valueStart] === "0" && valueEnd > valueStart + 1) ||
      !isJsonPropertyDelimiter(text, valueEnd)
    )
      continue;
    ranges.push([valueStart, valueEnd]);
  }
  let output = "";
  let offset = 0;
  for (const [start, end] of ranges) {
    output += `${text.slice(offset, start)}"${text.slice(start, end)}"`;
    offset = end;
  }
  return output + text.slice(offset);
}

function findJsonStringEnd(text: string, start: number): number {
  for (let index = start; index < text.length; index += 1) {
    if (text[index] === "\\") index += 1;
    else if (text[index] === '"') return index;
  }
  return -1;
}

function skipJsonWhitespace(text: string, start: number): number {
  let index = start;
  while (text[index] === " " || text[index] === "\t" || text[index] === "\n" || text[index] === "\r") index += 1;
  return index;
}

function isDecimalDigit(value: string | undefined): boolean {
  return value != null && value >= "0" && value <= "9";
}

function isJsonPropertyDelimiter(text: string, start: number): boolean {
  const delimiter = text[skipJsonWhitespace(text, start)];
  return delimiter === "," || delimiter === "}";
}

function requireLosslessId(value: unknown, fieldName: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new ProviderRequestError(502, `baidu_netdisk response is missing ${fieldName}`);
}

function requireInteger(value: unknown, fieldName: string): number {
  const integer = optionalInteger(value);
  if (integer == null) throw new ProviderRequestError(502, `baidu_netdisk response is missing ${fieldName}`);
  return integer;
}

function normalizeMembership(value: unknown): "free" | "vip" | "svip" | null {
  if (value === 0) return "free";
  if (value === 1) return "vip";
  if (value === 2) return "svip";
  return null;
}

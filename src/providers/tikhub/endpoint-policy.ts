import { TikHubRequestError } from "./errors.ts";

export type TikHubEndpointMethod = "GET" | "POST";

export interface TikHubEndpointPolicyMatch {
  placeholders: string[];
  requiredScope: string;
}

interface TikHubEndpointRule {
  category: string;
  method: TikHubEndpointMethod;
  path: string;
  requiredScope: string;
}

const tikhubEndpointRules = [
  approvedGet("TikTok-Web-API", "/api/v1/tiktok/web/fetch_user_profile"),
  approvedGet("TikTok-Web-API", "/api/v1/tiktok/web/fetch_post_detail"),
  approvedGet("TikTok-Web-API", "/api/v1/tiktok/web/fetch_user_post"),
  approvedGet("TikTok-Web-API", "/api/v1/tiktok/web/fetch_post_comment"),
  approvedGet("TikTok-Web-API", "/api/v1/tiktok/web/fetch_tag_detail"),
  approvedGet("TikTok-Web-API", "/api/v1/tiktok/web/fetch_tag_post"),
  approvedGet("Douyin-Web-API", "/api/v1/douyin/web/fetch_one_video"),
  approvedGet("Douyin-Web-API", "/api/v1/douyin/web/fetch_one_video_by_share_url"),
  approvedGet("Douyin-Web-API", "/api/v1/douyin/web/fetch_user_profile_by_uid"),
  approvedGet("Douyin-Web-API", "/api/v1/douyin/web/fetch_user_profile_by_short_id"),
  approvedGet("Douyin-Web-API", "/api/v1/douyin/web/fetch_video_comments"),
  approvedGet("Douyin-Web-API", "/api/v1/douyin/web/fetch_video_comment_replies"),
  approvedGet("Xiaohongshu-App-V2-API", "/api/v1/xiaohongshu/app_v2/search_notes"),
  approvedGet("Xiaohongshu-App-V2-API", "/api/v1/xiaohongshu/app_v2/search_users"),
  approvedGet("Xiaohongshu-App-V2-API", "/api/v1/xiaohongshu/app_v2/get_note_comments"),
  approvedGet("Xiaohongshu-App-V2-API", "/api/v1/xiaohongshu/app_v2/get_note_sub_comments"),
  approvedGet("Xiaohongshu-App-V2-API", "/api/v1/xiaohongshu/app_v2/get_user_info"),
  approvedGet("Xiaohongshu-App-V2-API", "/api/v1/xiaohongshu/app_v2/get_user_posted_notes"),
  approvedPost("Douyin-Search-API", "/api/v1/douyin/search/fetch_video_search_v1"),
  approvedPost("Douyin-Search-API", "/api/v1/douyin/search/fetch_user_search"),
  approvedGet("Douyin-Billboard-API", "/api/v1/douyin/billboard/fetch_hot_total_list"),
] as const satisfies readonly TikHubEndpointRule[];

const sensitiveRequestFieldNames = new Set([
  "authorization",
  "authtoken",
  "accesstoken",
  "refreshtoken",
  "apikey",
  "password",
  "passwd",
  "secret",
  "sessionid",
  "sessionkey",
  "deviceid",
  "fingerprint",
  "signature",
  "captcha",
  "mstoken",
  "xbogus",
  "abogus",
]);

export function isKnownTikHubEndpointCategory(category: string): boolean {
  return tikhubEndpointRules.some((rule) => rule.category === category);
}

export function isTikHubSensitiveRequestField(fieldName: string): boolean {
  const normalized = normalizeRequestFieldName(fieldName);
  return sensitiveRequestFieldNames.has(normalized) || normalized.includes("cookie");
}

function normalizeRequestFieldName(fieldName: string) {
  let normalized = "";
  for (const character of fieldName.trim().toLowerCase()) {
    const code = character.charCodeAt(0);
    const isDigit = code >= 48 && code <= 57;
    const isLowercase = code >= 97 && code <= 122;
    if (isDigit || isLowercase) {
      normalized += character;
    }
  }
  return normalized;
}

export function matchTikHubEndpointPolicy(
  methodInput: string,
  pathInput: string,
  category?: string,
): TikHubEndpointPolicyMatch | undefined {
  const method = normalizeMethod(methodInput);
  const { path, placeholders } = normalizePath(pathInput);
  const rule = tikhubEndpointRules.find(
    (candidate) =>
      candidate.path === path &&
      candidate.method === method &&
      (category === undefined || candidate.category === category),
  );
  if (!rule) {
    return undefined;
  }
  return { placeholders, requiredScope: rule.requiredScope };
}

export function assertTikHubEndpointEligible(
  methodInput: string,
  pathInput: string,
  category?: string,
): TikHubEndpointPolicyMatch {
  const match = matchTikHubEndpointPolicy(methodInput, pathInput, category);
  if (!match) {
    throw policyDenied();
  }
  return match;
}

export function assertResolvedTikHubEndpointEligible(
  methodInput: string,
  encodedPath: string,
): TikHubEndpointPolicyMatch {
  if (
    !encodedPath.startsWith("/api/") ||
    encodedPath.includes("?") ||
    encodedPath.includes("#") ||
    encodedPath.includes("\\") ||
    encodedPath.includes("{") ||
    encodedPath.includes("}") ||
    hasTikHubControlCharacter(encodedPath)
  ) {
    throw invalidEndpointInput("resolved path contains a forbidden component or character");
  }

  const decodedSegments: string[] = [];
  for (const encodedSegment of encodedPath.split("/").slice(1)) {
    let segment: string;
    try {
      segment = decodeURIComponent(encodedSegment);
    } catch {
      throw invalidEndpointInput("resolved path contains invalid percent encoding");
    }
    if (
      segment === "" ||
      segment === "." ||
      segment === ".." ||
      segment.includes("/") ||
      segment.includes("\\") ||
      segment.includes("?") ||
      segment.includes("#") ||
      segment.includes("%") ||
      hasTikHubControlCharacter(segment)
    ) {
      throw invalidEndpointInput("resolved path contains an invalid segment");
    }
    decodedSegments.push(segment);
  }

  const decodedPath = `/${decodedSegments.join("/")}`;
  const match = matchTikHubEndpointPolicy(methodInput, decodedPath);
  if (!match) {
    throw policyDenied();
  }
  return match;
}

function approvedGet(category: string, path: string): TikHubEndpointRule {
  return { category, method: "GET", path, requiredScope: requiredScopeForPath(path) };
}

function approvedPost(category: string, path: string): TikHubEndpointRule {
  return {
    category,
    method: "POST",
    path,
    requiredScope: requiredScopeForPath(path),
  };
}

function requiredScopeForPath(path: string) {
  return `${path.split("/").slice(0, 5).join("/")}/`;
}

function normalizeMethod(methodInput: string): TikHubEndpointMethod {
  if (typeof methodInput !== "string") {
    throw invalidEndpointInput("method must be GET or POST");
  }
  const method = methodInput.trim().toUpperCase();
  if (method !== "GET" && method !== "POST") {
    throw invalidEndpointInput("method must be GET or POST");
  }
  return method;
}

function normalizePath(pathInput: string) {
  if (typeof pathInput !== "string" || !pathInput.startsWith("/api/")) {
    throw invalidEndpointInput("path must be an absolute TikHub API path");
  }
  if (
    pathInput.includes("://") ||
    pathInput.includes("?") ||
    pathInput.includes("#") ||
    pathInput.includes("\\") ||
    pathInput.includes("%") ||
    hasTikHubControlCharacter(pathInput)
  ) {
    throw invalidEndpointInput("path contains a forbidden URL component or character");
  }

  const segments = pathInput.split("/").slice(1);
  const placeholders: string[] = [];
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") {
      throw invalidEndpointInput("path contains an empty or dot segment");
    }
    const isPlaceholder = segment.startsWith("{") && segment.endsWith("}");
    if (isPlaceholder) {
      const name = segment.slice(1, -1);
      if (!isSafePathToken(name) || placeholders.includes(name)) {
        throw invalidEndpointInput("path contains an invalid or duplicate placeholder");
      }
      placeholders.push(name);
      continue;
    }
    if (segment.includes("{") || segment.includes("}") || !isSafePathToken(segment)) {
      throw invalidEndpointInput("path contains an invalid segment");
    }
  }
  return { path: pathInput, placeholders };
}

function isSafePathToken(value: string) {
  if (value === "") {
    return false;
  }
  for (const character of value) {
    const code = character.charCodeAt(0);
    const isDigit = code >= 48 && code <= 57;
    const isUppercase = code >= 65 && code <= 90;
    const isLowercase = code >= 97 && code <= 122;
    if (!isDigit && !isUppercase && !isLowercase && character !== "_" && character !== "-") {
      return false;
    }
  }
  return true;
}

export function hasTikHubControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 31 || code === 127) {
      return true;
    }
  }
  return false;
}

function invalidEndpointInput(message: string) {
  return new TikHubRequestError("invalid_input", message, 400);
}

function policyDenied() {
  return new TikHubRequestError("policy_denied", "TikHub endpoint is outside the approved public-data policy", 403);
}

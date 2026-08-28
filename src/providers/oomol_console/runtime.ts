import type { OomolConsoleEndpoints } from "./request.ts";

import { ProviderRequestError } from "../provider-runtime.ts";
import { requestOomolConsole } from "./request.ts";

export interface OomolConsoleContext {
  accessToken: string;
  teamId?: string;
  fetcher: typeof fetch;
  signal?: AbortSignal;
}

type OomolPrincipalKind = "user" | "service_account" | "team_token";

export interface OomolConsoleRuntimeDeps {
  endpoints: OomolConsoleEndpoints;
  now?: () => number;
}

interface TeamView {
  id: string;
  name: string;
  avatar?: string;
  creatorUserId?: string;
  status?: "normal" | "paused";
  role?: "creator" | "admin" | "member" | "guest";
  writable?: boolean;
  systemCreated?: boolean;
}

interface TeamMemberView {
  userId: string;
  userType?: "user" | "service_account";
  name?: string;
  role: "creator" | "admin" | "member" | "guest";
  disabled: boolean;
}

interface BalanceLotView {
  id: string;
  sourceType: string;
  serviceScope: string;
  paymentAmount: number | null;
  currency: string | null;
  currentCredit: string;
  originalCredit: string;
  available: boolean;
  orderNumber: string | null;
  promoCode: string | null;
  expiresAt: number | null;
  createdAt: number;
}

interface BalanceView {
  items: BalanceLotView[];
  nextToken: null;
  total: { originalCredit: string; currentCredit: string } | null;
  deficit: string | null;
}

const dayMs = 24 * 60 * 60 * 1000;
const maxBalancePages = 100;
const excludedMeteringSubjects = ["SERVICE_OOMOL_CONNECTOR", "SERVICE_AUTH_LINK"]
  .flatMap((source) =>
    ["service-fusion-api-free", "service-fusion-api", "fusion-api"].map((subject) => `${source}:${subject}`),
  )
  .join(",");

export async function executeOomolConsoleAction(
  actionName: string,
  input: Record<string, unknown>,
  context: OomolConsoleContext,
  fetcher: typeof fetch,
  deps: OomolConsoleRuntimeDeps,
): Promise<unknown> {
  const oomolToken = requireOomolToken(context);

  switch (actionName) {
    case "get_current_scope": {
      const teamId = requireTeamId(context);
      const team = await getTeam(teamId, oomolToken, fetcher, deps.endpoints);
      const kind = getPrincipalKind(context);
      return {
        scope: { kind: "team", team },
        principal: { kind },
      };
    }
    case "list_teams": {
      requireAccountPrincipal(context);
      return {
        teams: await listTeams(oomolToken, fetcher, deps.endpoints),
      };
    }
    case "get_team_summary": {
      const teamId = requireTeamId(context);
      const [team, members] = await Promise.all([
        getTeam(teamId, oomolToken, fetcher, deps.endpoints),
        listTeamMembers(teamId, oomolToken, fetcher, deps.endpoints),
      ]);
      return {
        team,
        members: summarizeMembers(members),
      };
    }
    case "get_balance": {
      requireAccountPrincipal(context);
      return {
        scope: "account",
        ...(await getAllAvailableBalance(oomolToken, fetcher, deps.endpoints)),
      };
    }
    case "get_billing_summary": {
      requireAccountPrincipal(context);
      const period = createPeriod(input, deps.now?.() ?? Date.now());
      const [balance, billing, metering] = await Promise.all([
        getAllAvailableBalance(oomolToken, fetcher, deps.endpoints),
        getBillingStats(period, oomolToken, fetcher, deps.endpoints),
        getMeteringStats(period, oomolToken, fetcher, deps.endpoints),
      ]);
      return {
        scope: "account",
        period,
        generalBalanceCredit: sumDecimalStrings(
          balance.items.filter((lot) => lot.serviceScope === "GENERAL").map((lot) => lot.currentCredit),
        ),
        scopedAllowanceCredit: sumDecimalStrings(
          balance.items
            .filter((lot) => lot.serviceScope !== "GENERAL" && lot.serviceScope !== "SERVICE_AUTH_LINK")
            .map((lot) => lot.currentCredit),
        ),
        deficit: balance.deficit,
        spentCredit: billing.totalCredit,
        meteredEvents: metering.total.eventCount,
      };
    }
    case "get_usage_breakdown": {
      requireAccountPrincipal(context);
      const period = createPeriod(input, deps.now?.() ?? Date.now());
      const metering = await getMeteringStats(period, oomolToken, fetcher, deps.endpoints);
      return { scope: "account", ...metering };
    }
    case "list_members": {
      const teamId = requireTeamId(context);
      return {
        members: await listTeamMembers(teamId, oomolToken, fetcher, deps.endpoints),
      };
    }
    case "add_member": {
      requireUserPrincipal(context, "Adding an OOMOL team member requires a user principal");
      const teamId = requireTeamId(context);
      const userId = requireString(input.userId, "userId");
      await requestOomolConsole({
        endpoints: deps.endpoints,
        endpoint: "relationControl",
        path: `/v1/teams/${encodeURIComponent(teamId)}/members`,
        accessToken: oomolToken,
        fetcher,
        method: "POST",
        body: { user_id: userId, role: "member" },
      });
      return { added: true, teamId, userId, role: "member" };
    }
    case "list_connection_executions": {
      requireUserPrincipal(context, "Connection execution records require an OOMOL user principal");
      const teamId = requireTeamId(context);
      const appId = requireString(input.appId, "appId");
      return requestOomolConsole({
        endpoints: deps.endpoints,
        endpoint: "connector",
        path: `/v1/connections/by-id/${encodeURIComponent(appId)}/executions`,
        accessToken: oomolToken,
        fetcher,
        teamId,
        query: {
          action: optionalString(input.action),
          cursor: optionalString(input.cursor),
          limit: optionalNumber(input.limit),
          status: optionalExecutionStatus(input.status),
        },
      });
    }
  }
}

function requireOomolToken(context: OomolConsoleContext) {
  const token = context.accessToken.trim();
  if (!token) {
    throw new ProviderRequestError(400, "OOMOL access token is required");
  }
  return token;
}

function requireTeamId(context: OomolConsoleContext) {
  const teamId = context?.teamId?.trim();
  if (!teamId) {
    throw new ProviderRequestError(400, "A default OOMOL team ID is required for this action");
  }
  return teamId;
}

function getPrincipalKind(_context: OomolConsoleContext): OomolPrincipalKind {
  return "user";
}

function requireAccountPrincipal(context: OomolConsoleContext) {
  requireUserPrincipal(context, "This OOMOL account action requires a user principal");
}

function requireUserPrincipal(context: OomolConsoleContext, message: string) {
  if (getPrincipalKind(context) !== "user") {
    throw new ProviderRequestError(403, message);
  }
}

async function listTeams(oomolToken: string, fetcher: typeof fetch, endpoints: OomolConsoleEndpoints) {
  const payload = asRecord(
    await requestOomolConsole({
      endpoints,
      endpoint: "relationControl",
      path: "/v1/me/teams",
      accessToken: oomolToken,
      fetcher,
    }),
    "team list",
  );
  const teams = asArray(payload.teams, "team list teams").map(parseTeam);
  return teams.toSorted((left, right) => Number(Boolean(right.systemCreated)) - Number(Boolean(left.systemCreated)));
}

async function getTeam(teamId: string, oomolToken: string, fetcher: typeof fetch, endpoints: OomolConsoleEndpoints) {
  return parseTeam(
    await requestOomolConsole({
      endpoints,
      endpoint: "relationControl",
      path: `/v1/teams/${encodeURIComponent(teamId)}`,
      accessToken: oomolToken,
      fetcher,
    }),
  );
}

function parseTeam(value: unknown): TeamView {
  const team = asRecord(value, "team");
  return compact({
    id: readString(team.id, "team.id"),
    name: readString(team.name, "team.name"),
    avatar: readOptionalString(team.avatar),
    creatorUserId: readOptionalString(team.creator_user_id),
    status: readOptionalEnum(team.status, ["normal", "paused"] as const, "team.status"),
    role: readOptionalEnum(team.role, ["creator", "admin", "member", "guest"] as const, "team.role"),
    writable: readOptionalBoolean(team.writable, "team.writable"),
    systemCreated: readOptionalBoolean(team.system_created, "team.system_created"),
  });
}

async function listTeamMembers(
  teamId: string,
  oomolToken: string,
  fetcher: typeof fetch,
  endpoints: OomolConsoleEndpoints,
) {
  const payload = asRecord(
    await requestOomolConsole({
      endpoints,
      endpoint: "relationControl",
      path: `/v1/teams/${encodeURIComponent(teamId)}/members`,
      accessToken: oomolToken,
      fetcher,
    }),
    "team members",
  );
  return asArray(payload.members, "team members").map(parseTeamMember);
}

function parseTeamMember(value: unknown): TeamMemberView {
  const member = asRecord(value, "team member");
  return compact({
    userId: readString(member.user_id, "member.user_id"),
    userType: readOptionalEnum(
      member.user_type === "service-account" ? "service_account" : member.user_type,
      ["user", "service_account"] as const,
      "member.user_type",
    ),
    name: readOptionalString(member.name),
    role: readEnum(member.role, ["creator", "admin", "member", "guest"] as const, "member.role"),
    disabled: readOptionalBoolean(member.disable, "member.disable") ?? false,
  });
}

function summarizeMembers(members: TeamMemberView[]) {
  return {
    total: members.length,
    active: members.filter((member) => !member.disabled).length,
    disabled: members.filter((member) => member.disabled).length,
    users: members.filter((member) => member.userType !== "service_account").length,
    serviceAccounts: members.filter((member) => member.userType === "service_account").length,
  };
}

async function getAllAvailableBalance(
  oomolToken: string,
  fetcher: typeof fetch,
  endpoints: OomolConsoleEndpoints,
): Promise<BalanceView> {
  const pages: Array<{
    items: BalanceLotView[];
    nextToken: string | null;
    total: BalanceView["total"];
    deficit: string | null;
  }> = [];
  const seenTokens = new Set<string>();
  let nextToken: string | null = null;

  for (let pageIndex = 0; pageIndex < maxBalancePages; pageIndex += 1) {
    const payload = asRecord(
      await requestOomolConsole({
        endpoints,
        endpoint: "insight",
        path: "/v1/balance/available",
        accessToken: oomolToken,
        fetcher,
        query: { nextToken: nextToken ?? undefined },
      }),
      "available balance",
    );
    const page = {
      items: asArray(payload.items, "available balance items").map(parseBalanceLot),
      nextToken: readNullableString(payload.nextToken, "available balance nextToken"),
      total: parseBalanceTotal(payload.total),
      deficit: readNullableString(payload.deficit, "available balance deficit"),
    };
    pages.push(page);
    if (!page.nextToken) {
      return {
        items: pages.flatMap((item) => item.items),
        nextToken: null,
        total: pages[0]?.total ?? null,
        deficit: pages[0]?.deficit ?? null,
      };
    }
    if (seenTokens.has(page.nextToken)) {
      throw invalidResponse("available balance pagination repeated a nextToken");
    }
    seenTokens.add(page.nextToken);
    nextToken = page.nextToken;
  }

  throw invalidResponse("available balance exceeded the pagination limit");
}

function parseBalanceLot(value: unknown): BalanceLotView {
  const lot = asRecord(value, "balance lot");
  return {
    id: readString(lot.id, "balance lot.id"),
    sourceType: readString(lot.sourceType, "balance lot.sourceType"),
    serviceScope: readString(lot.serviceScope, "balance lot.serviceScope"),
    paymentAmount: readNullableNumber(lot.paymentAmount, "balance lot.paymentAmount"),
    currency: readNullableString(lot.currency, "balance lot.currency"),
    currentCredit: readString(lot.currentCredit, "balance lot.currentCredit"),
    originalCredit: readString(lot.originalCredit, "balance lot.originalCredit"),
    available: readBoolean(lot.available, "balance lot.available"),
    orderNumber: readNullableString(lot.orderNumber, "balance lot.orderNumber"),
    promoCode: readNullableString(lot.promoCode, "balance lot.promoCode"),
    expiresAt: readNullableNumber(lot.expiresAt, "balance lot.expiresAt"),
    createdAt: readNumber(lot.createdAt, "balance lot.createdAt"),
  };
}

function parseBalanceTotal(value: unknown): BalanceView["total"] {
  if (value == null) {
    return null;
  }
  const total = asRecord(value, "balance total");
  return {
    originalCredit: readString(total.originalCredit, "balance total.originalCredit"),
    currentCredit: readString(total.currentCredit, "balance total.currentCredit"),
  };
}

interface BillingPeriod {
  days: number;
  startTime: number;
  endTime: number;
  utcOffset: number;
}

function createPeriod(input: Record<string, unknown>, endTime: number): BillingPeriod {
  const days = optionalNumber(input.days) ?? 30;
  const utcOffset = optionalNumber(input.utcOffset) ?? 0;
  return { days, startTime: endTime - days * dayMs, endTime, utcOffset };
}

async function getBillingStats(
  period: BillingPeriod,
  oomolToken: string,
  fetcher: typeof fetch,
  endpoints: OomolConsoleEndpoints,
) {
  const payload = asRecord(
    await requestOomolConsole({
      endpoints,
      endpoint: "insight",
      path: "/v2/stats/billing",
      accessToken: oomolToken,
      fetcher,
      query: {
        granularity: "daily",
        startTime: period.startTime,
        endTime: period.endTime,
        utcOffset: period.utcOffset,
      },
    }),
    "billing stats",
  );
  const total = asRecord(payload.total, "billing stats total");
  return { totalCredit: readString(total.totalCredit, "billing stats total.totalCredit") };
}

async function getMeteringStats(
  period: BillingPeriod,
  oomolToken: string,
  fetcher: typeof fetch,
  endpoints: OomolConsoleEndpoints,
) {
  const payload = asRecord(
    await requestOomolConsole({
      endpoints,
      endpoint: "insight",
      path: "/v2/stats/metering",
      accessToken: oomolToken,
      fetcher,
      query: {
        granularity: "daily",
        startTime: period.startTime,
        endTime: period.endTime,
        utcOffset: period.utcOffset,
        excludeSubjects: excludedMeteringSubjects,
      },
    }),
    "metering stats",
  );
  const effectiveRange = asRecord(payload.effectiveRange, "metering effectiveRange");
  const total = asRecord(payload.total, "metering total");
  return {
    effectiveRange: {
      startTime: readNumber(effectiveRange.startTime, "metering effectiveRange.startTime"),
      endTime: readNumber(effectiveRange.endTime, "metering effectiveRange.endTime"),
    },
    dataAsOf: readNumber(payload.dataAsOf, "metering dataAsOf"),
    granularity: readEnum(payload.granularity, ["daily"] as const, "metering granularity"),
    items: asArray(payload.items, "metering items").map((value) => {
      const item = asRecord(value, "metering item");
      return compact({
        time: readNumber(item.time, "metering item.time"),
        source: readOptionalString(item.source),
        subject: readOptionalString(item.subject),
        totalUsage: readOptionalString(item.totalUsage),
        eventCount: readNumber(item.eventCount, "metering item.eventCount"),
      });
    }),
    total: { eventCount: readNumber(total.eventCount, "metering total.eventCount") },
    sourceTotals: parseSourceTotals(payload.sourceTotals),
    subjectTotals: parseSubjectTotals(payload.subjectTotals),
  };
}

function parseSourceTotals(value: unknown) {
  const sourceTotals = asRecord(value, "metering sourceTotals");
  return Object.fromEntries(
    Object.entries(sourceTotals).map(([source, rawTotal]) => {
      const total = asRecord(rawTotal, `metering sourceTotals.${source}`);
      return [source, { eventCount: readNumber(total.eventCount, `sourceTotals.${source}.eventCount`) }];
    }),
  );
}

function parseSubjectTotals(value: unknown) {
  const subjectTotals = asRecord(value, "metering subjectTotals");
  return Object.fromEntries(
    Object.entries(subjectTotals).map(([source, rawSubjects]) => [
      source,
      Object.fromEntries(
        Object.entries(asRecord(rawSubjects, `metering subjectTotals.${source}`)).map(([subject, rawTotal]) => {
          const total = asRecord(rawTotal, `metering subjectTotals.${source}.${subject}`);
          return [
            subject,
            {
              totalUsage: readString(total.totalUsage, `subjectTotals.${source}.${subject}.totalUsage`),
              eventCount: readNumber(total.eventCount, `subjectTotals.${source}.${subject}.eventCount`),
            },
          ];
        }),
      ),
    ]),
  );
}

function sumDecimalStrings(values: string[]) {
  const parsed = values.map(parseDecimal);
  const scale = parsed.reduce((maximum, value) => Math.max(maximum, value.scale), 0);
  const total = parsed.reduce((sum, value) => sum + value.integer * 10n ** BigInt(scale - value.scale), 0n);
  return formatDecimal(total, scale);
}

function parseDecimal(value: string) {
  const trimmed = value.trim();
  const negative = trimmed.startsWith("-");
  const unsigned = negative || trimmed.startsWith("+") ? trimmed.slice(1) : trimmed;
  const parts = unsigned.split(".");
  if (
    !unsigned ||
    parts.length > 2 ||
    parts.some((part) => part && [...part].some((character) => character < "0" || character > "9")) ||
    parts.every((part) => !part)
  ) {
    throw invalidResponse("balance credit is not a decimal string");
  }
  const fraction = parts[1] ?? "";
  const digits = `${parts[0] || "0"}${fraction}`;
  const integer = BigInt(digits) * (negative ? -1n : 1n);
  return { integer, scale: fraction.length };
}

function formatDecimal(value: bigint, scale: number) {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(scale + 1, "0");
  if (scale === 0) {
    return `${negative ? "-" : ""}${digits}`;
  }
  const integer = digits.slice(0, -scale);
  const fraction = digits.slice(-scale).replace(/0+$/u, "");
  return `${negative ? "-" : ""}${integer}${fraction ? `.${fraction}` : ""}`;
}

function requireString(value: unknown, fieldName: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new ProviderRequestError(400, `${fieldName} is required`);
  }
  return value.trim();
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalExecutionStatus(value: unknown) {
  return value === "success" || value === "error" ? value : undefined;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidResponse(`${label} is not an object`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, label: string) {
  if (!Array.isArray(value)) {
    throw invalidResponse(`${label} is not an array`);
  }
  return value;
}

function readString(value: unknown, label: string) {
  if (typeof value !== "string") {
    throw invalidResponse(`${label} is not a string`);
  }
  return value;
}

function readOptionalString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function readNullableString(value: unknown, label: string) {
  return value == null ? null : readString(value, label);
}

function readNumber(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw invalidResponse(`${label} is not a finite number`);
  }
  return value;
}

function readNullableNumber(value: unknown, label: string) {
  return value == null ? null : readNumber(value, label);
}

function readBoolean(value: unknown, label: string) {
  if (typeof value !== "boolean") {
    throw invalidResponse(`${label} is not a boolean`);
  }
  return value;
}

function readOptionalBoolean(value: unknown, label: string) {
  return value === undefined ? undefined : readBoolean(value, label);
}

function readEnum<const TValues extends readonly string[]>(
  value: unknown,
  values: TValues,
  label: string,
): TValues[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    throw invalidResponse(`${label} is invalid`);
  }
  return value as TValues[number];
}

function readOptionalEnum<const TValues extends readonly string[]>(value: unknown, values: TValues, label: string) {
  return value === undefined ? undefined : readEnum(value, values, label);
}

function compact<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as {
    [K in keyof T as undefined extends T[K] ? never : K]: T[K];
  } & Partial<T>;
}

function invalidResponse(message: string) {
  return new ProviderRequestError(502, `OOMOL Console response is invalid: ${message}`);
}

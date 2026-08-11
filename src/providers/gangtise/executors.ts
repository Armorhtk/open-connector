import type {
  CredentialValidators,
  ExecutionContext,
  ProviderExecutors,
  ProviderProxyExecutor,
} from "../../core/types.ts";

import {
  defineProviderExecutors,
  defineProviderProxy,
  providerUserAgent,
  requireApiKeyCredential,
} from "../provider-runtime.ts";
import {
  createGangtiseSession,
  executeGangtiseAction,
  gangtiseApiBaseUrl,
  validateGangtiseCredential,
} from "./runtime.ts";

const service = "gangtise";
type GangtiseContext = {
  apiKey: string;
  values: Record<string, string>;
  fetcher: typeof fetch;
};

export const executors: ProviderExecutors = defineProviderExecutors({
  service,
  handlers: Object.fromEntries(
    [
      "search_securities",
      "get_realtime_quotes",
      "get_daily_kline",
      "get_minute_kline",
      "get_financial_statements",
      "get_valuation_metrics",
      "get_earnings_forecast",
      "get_main_business_breakdown",
      "get_top_shareholders",
      "get_fund_flow",
      "search_company_indicators",
      "get_company_indicators",
      "search_reports",
      "search_meeting_summaries",
      "search_announcements",
    ].map((actionName) => [
      actionName,
      (input: Record<string, unknown>, context: GangtiseContext) =>
        executeGangtiseAction({ apiKey: context.apiKey, values: context.values, actionName, input }, context.fetcher),
    ]),
  ),
  skipDnsValidation: true,
  async createContext(context: ExecutionContext, fetcher): Promise<GangtiseContext> {
    const credential = await requireApiKeyCredential(context, service);
    return { apiKey: credential.apiKey, values: credential.values, fetcher };
  },
});

export const credentialValidators: CredentialValidators = {
  async apiKey(input, { fetcher }) {
    const result = await validateGangtiseCredential({ apiKey: input.apiKey, ...input.values }, fetcher);
    return {
      profile: { displayName: result.accountLabel },
      grantedScopes: result.providerScopes,
      metadata: result.providerMetadata,
    };
  },
};

export const proxy: ProviderProxyExecutor = defineProviderProxy({
  service,
  baseUrl: gangtiseApiBaseUrl,
  auth: { type: "none" },
  skipDnsValidation: true,
  async customizeRequest({ context, fetcher, headers }) {
    const credential = await requireApiKeyCredential(context, service);
    const session = await createGangtiseSession(
      { apiKey: credential.apiKey, values: credential.values },
      fetcher,
      "execute",
    );
    headers.set("authorization", session.authorization);
    if (!headers.has("accept")) headers.set("accept", "application/json");
    if (!headers.has("user-agent")) headers.set("user-agent", providerUserAgent);
  },
});

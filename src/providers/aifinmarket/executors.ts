import type { CredentialValidators, ProviderExecutors, ProviderProxyExecutor } from "../../core/types.ts";

import { defineApiKeyProviderExecutors, defineProviderProxy } from "../provider-runtime.ts";
import { callTool, discoverAccessibleTools, listTools } from "./runtime.ts";

const service = "aifinmarket";
const namedActions = [
  "get_stock_price_indicators",
  "get_stock_kline",
  "search_stocks",
  "get_stock_fundamentals",
  "get_fund_price_indicators",
  "get_fund_kline",
  "search_funds",
  "get_fund_performance",
  "get_index_price_indicators",
  "get_index_kline",
  "get_company_announcements",
  "get_financial_news",
  "natural_language_get_edb_data",
];

export const executors: ProviderExecutors = defineApiKeyProviderExecutors(service, {
  async list_tools(input, context) {
    return listTools(String(input.serverType) as Parameters<typeof listTools>[0], context);
  },
  async call_tool(input, context) {
    return callTool("call_tool", input, context);
  },
  ...Object.fromEntries(
    namedActions.map((actionName) => [
      actionName,
      (input: Record<string, unknown>, context: Parameters<typeof callTool>[2]) => callTool(actionName, input, context),
    ]),
  ),
});

export const credentialValidators: CredentialValidators = {
  async apiKey(input, { fetcher, signal }) {
    const discovered = await discoverAccessibleTools({ apiKey: input.apiKey.trim(), fetcher, signal });
    const bytes = new TextEncoder().encode(input.apiKey.trim());
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const keyHash = Array.from(new Uint8Array(digest))
      .slice(0, 8)
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    return {
      profile: {
        accountId: `aifinmarket:mcp:${keyHash}`,
        displayName: `Wind AIFin Market · ${keyHash.slice(-6)}`,
      },
      grantedScopes: [],
      metadata: {
        mcpOrigin: "https://mcp.wind.com.cn",
        validationServerType: discovered.serverType,
        discoveredToolCount: discovered.tools.length,
      },
    };
  },
};

export const proxy: ProviderProxyExecutor = defineProviderProxy({
  service,
  baseUrl: "https://mcp.wind.com.cn",
  auth: { type: "api_key_authorization", prefix: "Bearer " },
  skipDnsValidation: true,
  customizeRequest({ headers }) {
    if (!headers.has("accept")) headers.set("accept", "application/json, text/event-stream");
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
  },
});

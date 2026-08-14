import type { CredentialValidators, ProviderExecutors, ProviderProxyExecutor } from "../../core/types.ts";

import { defineProviderExecutors, defineProviderProxy, requireApiKeyCredential } from "../provider-runtime.ts";
import { executeSmartsuiteAction, validateSmartsuiteCredential } from "./runtime.ts";

const service = "smartsuite";

interface SmartsuiteContext {
  apiKey: string;
  workspaceId: string;
  fetcher: typeof fetch;
}

const handlers: Record<string, (input: Record<string, unknown>, context: SmartsuiteContext) => Promise<unknown>> = {};
for (const name of [
  "list_solutions",
  "list_tables",
  "list_records",
  "get_record",
  "create_record",
  "update_record",
  "delete_record",
]) {
  handlers[name] = (input, context) =>
    executeSmartsuiteAction(
      { apiKey: context.apiKey, values: { workspaceId: context.workspaceId }, actionName: name, input },
      context.fetcher,
    );
}

export const executors: ProviderExecutors = defineProviderExecutors<SmartsuiteContext>({
  service,
  handlers,
  skipDnsValidation: true,
  async createContext(context, fetcher) {
    const credential = await requireApiKeyCredential(context, service);
    return { apiKey: credential.apiKey, workspaceId: credential.values.workspaceId ?? "", fetcher };
  },
});

export const credentialValidators: CredentialValidators = {
  async apiKey(input, { fetcher }) {
    const result = await validateSmartsuiteCredential(
      { apiKey: input.apiKey, workspaceId: input.values.workspaceId ?? "" },
      fetcher,
    );
    return { profile: { displayName: result.accountLabel }, grantedScopes: [], metadata: result.providerMetadata };
  },
};

export const proxy: ProviderProxyExecutor = defineProviderProxy({
  service,
  baseUrl: "https://app.smartsuite.com/api/v1",
  auth: { type: "api_key_authorization", prefix: "Token " },
  skipDnsValidation: true,
  customizeRequest({ credential, headers }) {
    if (credential?.authType === "api_key") headers.set("ACCOUNT-ID", credential.values.workspaceId ?? "");
  },
});

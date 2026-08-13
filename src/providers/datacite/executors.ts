import type { CredentialValidators, ExecutionContext, ProviderExecutors } from "../../core/types.ts";

import { defineProviderExecutors, ProviderRequestError } from "../provider-runtime.ts";
import { executeDataciteAction, validateDataciteCredential } from "./runtime.ts";
const service = "datacite";
interface DataciteContext {
  apiKey?: string;
  fetcher: typeof fetch;
}
const handlers = Object.fromEntries(
  ["get_doi", "list_dois"].map((name) => [
    name,
    (input: Record<string, unknown>, context: DataciteContext) =>
      executeDataciteAction(name, input, context.fetcher, context.apiKey),
  ]),
);
export const executors: ProviderExecutors = defineProviderExecutors<DataciteContext>({
  service,
  handlers,
  async createContext(context: ExecutionContext, fetcher: typeof fetch) {
    const credential = await context.getCredential(service);
    if (!credential || credential.authType == "no_auth") return { fetcher };
    if (credential.authType == "api_key") return { apiKey: credential.apiKey, fetcher };
    throw new ProviderRequestError(401, "Connect DataCite without authentication or configure an API key.");
  },
  skipDnsValidation: true,
});
export const credentialValidators: CredentialValidators = {
  apiKey(input, { fetcher }) {
    return validateDataciteCredential({ apiKey: input.apiKey, ...input.values }, fetcher);
  },
};

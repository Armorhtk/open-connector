import type { CredentialValidators, ProviderExecutors } from "../../core/types.ts";

import { defineApiKeyProviderExecutors } from "../provider-runtime.ts";
import { validateVolcengineArkCredential, volcengineArkActionHandlers } from "./runtime.ts";

const service = "volcengine_ark";

export const executors: ProviderExecutors = defineApiKeyProviderExecutors(service, volcengineArkActionHandlers, {
  skipDnsValidation: true,
});

export const credentialValidators: CredentialValidators = {
  apiKey(input, { fetcher, signal }) {
    return validateVolcengineArkCredential(input.apiKey, fetcher, signal);
  },
};

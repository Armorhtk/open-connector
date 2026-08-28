import { ProviderRequestError } from "../provider-runtime.ts";

export type TikHubErrorCode =
  | "credential_expired"
  | "invalid_input"
  | "policy_denied"
  | "provider_error"
  | "rate_limited"
  | "scope_missing";

/** Preserves TikHub-specific error categories within the open-source runtime error contract. */
export class TikHubRequestError extends ProviderRequestError {
  constructor(code: TikHubErrorCode, message: string, status: number, _cause?: unknown, details?: unknown) {
    super(status, message, details, code);
  }
}

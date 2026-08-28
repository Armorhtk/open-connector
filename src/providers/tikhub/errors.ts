import { ProviderRequestError } from "../provider-runtime.ts";

export type TikHubErrorCode =
  | "credential_expired"
  | "invalid_input"
  | "policy_denied"
  | "provider_error"
  | "rate_limited"
  | "scope_missing";

/** 在开源运行时错误契约下保留 TikHub 自身的错误分类。 */
export class TikHubRequestError extends ProviderRequestError {
  constructor(code: TikHubErrorCode, message: string, status: number, _cause?: unknown, details?: unknown) {
    super(status, message, details, code);
  }
}

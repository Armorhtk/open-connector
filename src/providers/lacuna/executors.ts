import type { ExecutionContext, ProviderExecutors } from "../../core/types.ts";
import type { ProviderFetch } from "../provider-runtime.ts";
import type { LacunaActionContext } from "./runtime.ts";

import { defineProviderExecutors } from "../provider-runtime.ts";
import { lacunaActionHandlers } from "./runtime.ts";

export const executors: ProviderExecutors = defineProviderExecutors<LacunaActionContext>({
  service: "lacuna",
  handlers: lacunaActionHandlers,
  createContext(context: ExecutionContext, fetcher: ProviderFetch): LacunaActionContext {
    return { fetcher, signal: context.signal };
  },
  fallbackMessage: "Lacuna request failed.",
});

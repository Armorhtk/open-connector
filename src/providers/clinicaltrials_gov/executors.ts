import type { ProviderExecutors } from "../../core/types.ts";

import { defineProviderExecutors } from "../provider-runtime.ts";
import { clinicalTrialsGovActionHandlers } from "./runtime.ts";
const service = "clinicaltrials_gov";
interface ClinicalTrialsContext {
  fetcher: typeof fetch;
}
const handlers = Object.fromEntries(
  Object.entries(clinicalTrialsGovActionHandlers).map(([name, handler]) => [
    name,
    (input: Record<string, unknown>, context: ClinicalTrialsContext) => handler(input, context.fetcher),
  ]),
);
export const executors: ProviderExecutors = defineProviderExecutors<ClinicalTrialsContext>({
  service,
  handlers,
  createContext: (_context, fetcher) => ({ fetcher }),
  skipDnsValidation: true,
});

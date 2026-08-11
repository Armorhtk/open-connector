import { defineProviderExecutors, ProviderRequestError, providerUserAgent } from "../provider-runtime.ts";

const paths: Record<string, string> = {
  get_creator: "/api/public/creators/getCreator",
  list_active_crowdfunding_projects: "/api/public/projects/getActiveCrowdfundingProjects",
  get_crowdfunding_project: "/api/public/projects/getCrowdfundingProject",
};
async function execute(
  input: Record<string, unknown>,
  context: { fetcher: typeof fetch },
  name: string,
): Promise<unknown> {
  const url = new URL(paths[name]!, "https://www.indiegogo.com");
  if (input.urlName !== undefined) url.searchParams.set("urlName", String(input.urlName));
  const response = await context.fetcher(url, {
    headers: { accept: "application/json", "user-agent": providerUserAgent },
    redirect: "error",
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok)
    throw new ProviderRequestError(response.status, `Indiegogo request failed with status ${response.status}`, payload);
  return name === "list_active_crowdfunding_projects"
    ? { projects: payload }
    : name === "get_creator"
      ? { creator: payload }
      : { project: payload };
}
export const executors: import("../../core/types.ts").ProviderExecutors = defineProviderExecutors({
  service: "indiegogo",
  createContext: (_context, fetcher) => ({ fetcher }),
  skipDnsValidation: true,
  handlers: {
    get_creator: (input, context) => execute(input, context, "get_creator"),
    list_active_crowdfunding_projects: (input, context) => execute(input, context, "list_active_crowdfunding_projects"),
    get_crowdfunding_project: (input, context) => execute(input, context, "get_crowdfunding_project"),
  },
});

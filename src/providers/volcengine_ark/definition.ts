import type { ProviderDefinition } from "../../core/types.ts";

import { volcengineArkActions } from "./actions.ts";

const service = "volcengine_ark";

export const provider: ProviderDefinition = {
  service,
  displayName: "Volcengine Ark",
  categories: ["AI", "Design & Media"],
  authTypes: ["api_key"],
  auth: [
    {
      type: "api_key",
      label: "Ark API Key",
      placeholder: "Your Volcengine Ark API key",
      description:
        "Volcengine Ark API key sent as a Bearer token. Create an API key in the Ark console: https://console.volcengine.com/ark/region:ark+cn-beijing/apikey.",
    },
  ],
  homepageUrl: "https://www.volcengine.com/product/ark",
  actions: volcengineArkActions,
};

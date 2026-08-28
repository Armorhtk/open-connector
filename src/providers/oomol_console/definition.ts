import type { ProviderDefinition } from "../../core/types.ts";

import { oomolConsoleActions } from "./actions.ts";

export const provider: ProviderDefinition = {
  service: "oomol_console",
  displayName: "OOMOL Console",
  description: "Inspect OOMOL teams, billing, usage, members, and connector execution history.",
  categories: ["Productivity", "Developer Tools"],
  authTypes: ["custom_credential"],
  auth: [
    {
      type: "custom_credential",
      fields: [
        {
          key: "accessToken",
          label: "OOMOL Access Token",
          inputType: "password",
          required: true,
          secret: true,
          placeholder: "OOMOL_ACCESS_TOKEN",
          description:
            "OOMOL user access token used to call Console APIs. Obtain it from your account at https://console.oomol.com.",
        },
        {
          key: "teamId",
          label: "Default Team ID",
          inputType: "text",
          required: false,
          secret: false,
          placeholder: "team-id",
          description:
            "Optional OOMOL team ID used by team-scoped actions. You can discover accessible teams with list_teams.",
        },
      ],
    },
  ],
  homepageUrl: "https://console.oomol.com",
  actions: oomolConsoleActions,
};

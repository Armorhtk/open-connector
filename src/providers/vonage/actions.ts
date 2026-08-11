import type { ActionDefinition } from "../../core/types.ts";

import { s } from "../../core/json-schema.ts";
import { defineProviderAction } from "../../core/provider-definition.ts";

const smsMessageSchema = s.object("One normalized Vonage SMS submission result.", {
  to: s.string("The destination number in E.164 format."),
  messageId: s.string("The Vonage message identifier."),
  status: s.string("The Vonage SMS status code."),
  remainingBalance: s.nullable(s.string("The estimated remaining account balance.")),
  messagePrice: s.nullable(s.string("The estimated price of the message.")),
  network: s.nullable(s.string("The destination network identifier.")),
  clientRef: s.nullable(s.string("The caller-supplied client reference.")),
});

export const vonageActions: ActionDefinition[] = [
  defineProviderAction("vonage", {
    name: "get_balance",
    description: "Retrieve the current balance of the connected Vonage API account.",
    requiredScopes: [],
    inputSchema: s.object("No input is required for this action.", {}),
    outputSchema: s.object("The current Vonage account balance.", {
      value: s.number("The account balance in euros."),
      autoReload: s.boolean("Whether automatic balance reload is enabled."),
    }),
  }),
  defineProviderAction("vonage", {
    name: "send_sms",
    description: "Send a text or Unicode SMS through the Vonage SMS API.",
    requiredScopes: [],
    inputSchema: s.object(
      "The outbound Vonage SMS payload.",
      {
        from: s.nonEmptyString(
          "The sender name or number. Number senders use E.164 format; sender ID rules vary by country.",
        ),
        to: s.string("The destination number in E.164 format without a leading plus sign.", {
          minLength: 7,
          maxLength: 15,
          pattern: "^[0-9]{7,15}$",
        }),
        text: s.nonEmptyString("The text body of the outbound SMS."),
        type: s.stringEnum("The SMS text encoding.", ["text", "unicode"]),
        ttl: s.integer("How long Vonage should attempt delivery, in milliseconds.", {
          minimum: 20_000,
          maximum: 604_800_000,
        }),
        statusReportRequired: s.boolean("Whether Vonage should request a delivery receipt."),
        callback: s.string("The delivery receipt callback URL for this message.", {
          maxLength: 100,
          format: "uri",
        }),
        clientRef: s.string("A caller-defined reference included in the submission result.", {
          maxLength: 100,
        }),
      },
      { optional: ["type", "ttl", "statusReportRequired", "callback", "clientRef"] },
    ),
    outputSchema: s.object("The normalized Vonage SMS submission response.", {
      messageCount: s.integer("The number of SMS submission results returned by Vonage."),
      messages: s.array("The submitted SMS results.", smsMessageSchema),
    }),
  }),
];

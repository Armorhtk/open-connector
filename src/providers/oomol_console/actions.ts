import type { ProviderActionDefinition } from "../../core/provider-definition.ts";

import { jsonSchema as s } from "../../core/json-schema.ts";
import { defineProviderAction } from "../../core/provider-definition.ts";

const service = "oomol_console";

const teamRoleSchema = s.stringEnum("The role held by the principal in the team.", [
  "creator",
  "admin",
  "member",
  "guest",
]);

const teamSchema = s.object(
  "A team visible to the authenticated OOMOL principal.",
  {
    id: s.nonWhitespaceString("The OOMOL team identifier."),
    name: s.string("The team display name."),
    avatar: s.string("The team avatar URL."),
    creatorUserId: s.string("The user identifier of the team creator."),
    status: s.stringEnum("The current team status.", ["normal", "paused"]),
    role: teamRoleSchema,
    writable: s.boolean("Whether the authenticated principal can modify the team."),
    systemCreated: s.boolean("Whether OOMOL created the team as the account's default team."),
  },
  {
    optional: ["avatar", "creatorUserId", "status", "role", "writable", "systemCreated"],
  },
);

const teamMemberSchema = s.object(
  "A member of the current OOMOL team.",
  {
    userId: s.nonWhitespaceString("The OOMOL user or service-account identifier."),
    userType: s.stringEnum("The type of team member.", ["user", "service_account"]),
    name: s.string("The member display name."),
    role: teamRoleSchema,
    disabled: s.boolean("Whether the member is disabled in the team."),
  },
  { optional: ["userType", "name"] },
);

const balanceLotSchema = s.object("One available OOMOL balance lot.", {
  id: s.nonWhitespaceString("The balance lot identifier."),
  sourceType: s.string("The source type that created the balance lot."),
  serviceScope: s.string("The service scope that can consume the balance lot."),
  paymentAmount: s.nullable(s.number("The payment amount associated with the lot.")),
  currency: s.nullable(s.string("The payment currency associated with the lot.")),
  currentCredit: s.string("The remaining credit represented as an exact decimal string."),
  originalCredit: s.string("The original credit represented as an exact decimal string."),
  available: s.boolean("Whether the balance lot is currently available."),
  orderNumber: s.nullable(s.string("The billing order number associated with the lot.")),
  promoCode: s.nullable(s.string("The promotional code associated with the lot.")),
  expiresAt: s.nullable(s.number("The expiration timestamp in milliseconds.")),
  createdAt: s.number("The creation timestamp in milliseconds."),
});

const statsMeteringPointSchema = s.object(
  "One daily OOMOL usage data point.",
  {
    time: s.number("The start timestamp of the data point in milliseconds."),
    source: s.string("The metering source represented by the data point."),
    subject: s.string("The metering subject represented by the data point."),
    totalUsage: s.string("The total usage reported for the data point."),
    eventCount: s.nonNegativeInteger("The number of metering events in the data point."),
  },
  { optional: ["source", "subject", "totalUsage"] },
);

const meteringSubjectTotalSchema = s.object("The usage total for one metering subject.", {
  totalUsage: s.string("The total usage reported for the subject."),
  eventCount: s.nonNegativeInteger("The number of metering events reported for the subject."),
});

const statsRangeSchema = s.object("The effective time range used by OOMOL Insight.", {
  startTime: s.number("The inclusive range start timestamp in milliseconds."),
  endTime: s.number("The exclusive range end timestamp in milliseconds."),
});

const executionLogItemSchema = s.object(
  "One action execution record for the requested Connection.",
  {
    executionId: s.nonWhitespaceString("The execution identifier."),
    service: s.nonWhitespaceString("The provider service identifier."),
    action: s.nonWhitespaceString("The executed action name."),
    actor: s.string("The actor that triggered the execution."),
    userId: s.string("The user or service-account identifier that ran the action."),
    status: s.stringEnum("The execution result status.", ["success", "error"]),
    errorCode: s.string("The normalized execution error code."),
    errorMessage: s.string("The execution error message."),
    startedAt: s.string("The execution start timestamp."),
    finishedAt: s.string("The execution finish timestamp."),
    input: s.unknown("The logged action input after configured redaction."),
    outputSummary: s.string("The summarized action output after configured redaction."),
  },
  { optional: ["userId"] },
);

const emptyInputSchema = (description: string) => s.object(description, {});

const billingWindowInputSchema = (description: string) =>
  s.object(description, {
    days: s.integer("The number of trailing days to include.", {
      minimum: 1,
      maximum: 90,
      default: 30,
    }),
    utcOffset: s.integer("The UTC offset in whole hours used for daily boundaries.", {
      minimum: -12,
      maximum: 14,
      default: 0,
    }),
  });

export const oomolConsoleActions: ProviderActionDefinition[] = [
  defineProviderAction(service, {
    name: "get_current_scope",
    description: "Return the current OOMOL team scope and authenticated principal.",
    requiredScopes: [],
    inputSchema: emptyInputSchema("The input payload for reading the current OOMOL scope."),
    outputSchema: s.object("The current OOMOL execution scope.", {
      scope: s.object("The current team scope.", {
        kind: s.literal("team", { description: "The execution scope kind." }),
        team: teamSchema,
      }),
      principal: s.object(
        "The principal authenticated for the current action execution.",
        {
          kind: s.stringEnum("The authenticated OOMOL principal type.", ["user", "service_account", "team_token"]),
          id: s.string("The user or service-account identifier when one is available."),
        },
        { optional: ["id"] },
      ),
    }),
  }),
  defineProviderAction(service, {
    name: "list_teams",
    description: "List the OOMOL teams visible to the authenticated account.",
    requiredScopes: [],
    inputSchema: emptyInputSchema("The input payload for listing OOMOL teams."),
    outputSchema: s.object("The teams visible to the authenticated OOMOL account.", {
      teams: s.array("The visible teams, with the system-created team first.", teamSchema),
    }),
  }),
  defineProviderAction(service, {
    name: "get_team_summary",
    description: "Return metadata and member counts for the current OOMOL team.",
    requiredScopes: [],
    inputSchema: emptyInputSchema("The input payload for reading the current team summary."),
    outputSchema: s.object("A summary of the current OOMOL team.", {
      team: teamSchema,
      members: s.object("Derived counts for members of the current team.", {
        total: s.nonNegativeInteger("The total number of team members."),
        active: s.nonNegativeInteger("The number of active team members."),
        disabled: s.nonNegativeInteger("The number of disabled team members."),
        users: s.nonNegativeInteger("The number of user members."),
        serviceAccounts: s.nonNegativeInteger("The number of service-account members."),
      }),
    }),
  }),
  defineProviderAction(service, {
    name: "get_balance",
    description: "Return every available balance lot for the authenticated OOMOL account.",
    requiredScopes: [],
    inputSchema: emptyInputSchema("The input payload for reading the OOMOL account balance."),
    outputSchema: s.object("The complete available balance for the OOMOL account.", {
      scope: s.literal("account", { description: "The billing scope represented by this result." }),
      items: s.array("All available balance lots across every upstream page.", balanceLotSchema),
      nextToken: s.nullable(s.string("The next page token, always null after full aggregation.")),
      total: s.nullable(
        s.object("The aggregate credit totals returned by OOMOL Insight.", {
          originalCredit: s.string("The original aggregate credit as an exact decimal string."),
          currentCredit: s.string("The remaining aggregate credit as an exact decimal string."),
        }),
      ),
      deficit: s.nullable(s.string("The account deficit as an exact decimal string.")),
    }),
  }),
  defineProviderAction(service, {
    name: "get_billing_summary",
    description: "Return the compact OOMOL account billing metrics shown by Console.",
    requiredScopes: [],
    inputSchema: billingWindowInputSchema("The time window used to summarize OOMOL account billing."),
    outputSchema: s.object("A compact billing summary for the OOMOL account.", {
      scope: s.literal("account", { description: "The billing scope represented by this result." }),
      period: s.object("The requested billing summary period.", {
        days: s.integer("The number of trailing days included in the summary."),
        startTime: s.number("The period start timestamp in milliseconds."),
        endTime: s.number("The period end timestamp in milliseconds."),
        utcOffset: s.integer("The UTC offset used for daily boundaries."),
      }),
      generalBalanceCredit: s.string("The remaining GENERAL credit as an exact decimal string."),
      scopedAllowanceCredit: s.string("The remaining non-general visible allowance as an exact decimal string."),
      deficit: s.nullable(s.string("The account deficit as an exact decimal string.")),
      spentCredit: s.string("The credit spent during the period as an exact decimal string."),
      meteredEvents: s.nonNegativeInteger("The number of metered events during the period."),
    }),
  }),
  defineProviderAction(service, {
    name: "get_usage_breakdown",
    description: "Return the daily OOMOL account usage breakdown by source and subject.",
    requiredScopes: [],
    inputSchema: billingWindowInputSchema("The time window used to read the OOMOL account usage breakdown."),
    outputSchema: s.object("The OOMOL Insight metering breakdown for the account.", {
      scope: s.literal("account", { description: "The usage scope represented by this result." }),
      effectiveRange: statsRangeSchema,
      dataAsOf: s.number("The timestamp through which metering data is complete."),
      granularity: s.literal("daily", { description: "The time granularity of the returned series." }),
      items: s.array("The daily metering series.", statsMeteringPointSchema),
      total: s.object("The metering total across all returned sources.", {
        eventCount: s.nonNegativeInteger("The total number of metering events."),
      }),
      sourceTotals: s.record(
        "Metering event totals keyed by source.",
        s.object("The metering total for one source.", {
          eventCount: s.nonNegativeInteger("The number of metering events for the source."),
        }),
      ),
      subjectTotals: s.record(
        "Metering totals keyed first by source and then by subject.",
        s.record("Metering totals keyed by subject.", meteringSubjectTotalSchema),
      ),
    }),
  }),
  defineProviderAction(service, {
    name: "list_members",
    description: "List members of the current OOMOL team.",
    requiredScopes: [],
    inputSchema: emptyInputSchema("The input payload for listing current-team members."),
    outputSchema: s.object("The members of the current OOMOL team.", {
      members: s.array("The current-team members.", teamMemberSchema),
    }),
  }),
  defineProviderAction(service, {
    name: "add_member",
    description: "Add an OOMOL user to the current team with the member role.",
    requiredScopes: [],
    inputSchema: s.object("The input payload for adding a member to the current OOMOL team.", {
      userId: s.nonWhitespaceString("The exact OOMOL user identifier to add."),
    }),
    outputSchema: s.object("Confirmation that the OOMOL team member was added.", {
      added: s.literal(true, { description: "Whether the member was added successfully." }),
      teamId: s.nonWhitespaceString("The current OOMOL team identifier."),
      userId: s.nonWhitespaceString("The OOMOL user identifier that was added."),
      role: s.literal("member", { description: "The role assigned to the new team member." }),
    }),
  }),
  defineProviderAction(service, {
    name: "list_connection_executions",
    description: "List the execution records shown on an OOMOL Console Connection details page.",
    requiredScopes: [],
    inputSchema: s.object(
      "The filters used to list execution records for one current-team Connection.",
      {
        appId: s.nonWhitespaceString("The Connector App ID shown on the Connection details page."),
        action: s.nonWhitespaceString("Only return executions for this action name."),
        cursor: s.nonWhitespaceString("The cursor returned by the previous page."),
        limit: s.integer("The maximum number of execution records to return.", {
          minimum: 1,
          maximum: 100,
          default: 20,
        }),
        status: s.stringEnum("Only return executions with this result status.", ["success", "error"]),
      },
      { optional: ["action", "cursor", "status"] },
    ),
    outputSchema: s.object(
      "A paginated page of Connection execution records.",
      {
        data: s.array("The execution records visible to the current principal.", executionLogItemSchema),
        nextCursor: s.string("The cursor for loading the next page."),
      },
      { optional: ["nextCursor"] },
    ),
  }),
];

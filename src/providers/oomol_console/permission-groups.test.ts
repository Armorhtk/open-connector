import { expect, test } from "vitest";
import {
  parseConnectionPermissionGroups,
  replacePermissionGroupMembers,
  serializeConnectionPermissionGroups,
} from "./permission-groups.ts";

const target = { appId: "app-gmail", service: "gmail" };
const members = ["alice", "bob", "carol"];

test("reads an unconfigured connection as an all-member default group", () => {
  expect(parseConnectionPermissionGroups({}, target, members)).toEqual({
    ok: true,
    value: {
      sourceFormat: "unconfigured",
      defaultGroup: { actionPermission: { mode: "all" } },
      groups: [],
    },
  });
});

test("normalizes multi-group permissions and ignores stale assignments", () => {
  const result = parseConnectionPermissionGroups(
    {
      "role::connector-app:app-gmail": {
        connector: [
          {
            app: ["app-gmail"],
            method: "POST",
            provider: "gmail",
            permissionRules: {
              teamDefault: { actions: [] },
              rules: [{ id: "readers", name: "Readers", actions: ["read_email"] }],
              assignments: { alice: "readers", stale: "readers" },
            },
          },
        ],
      },
    },
    target,
    members,
  );
  expect(result).toMatchObject({
    ok: true,
    value: {
      defaultGroup: { actionPermission: { mode: "none" } },
      groups: [{ groupId: "readers", memberIds: ["alice"] }],
    },
  });
});

test("replaces a complete member set and preserves unrelated policy entries", () => {
  const state = {
    sourceFormat: "multi" as const,
    defaultGroup: { actionPermission: { mode: "none" as const } },
    groups: [
      { groupId: "readers", name: "Readers", memberIds: ["alice"], actionPermission: { mode: "all" as const } },
      { groupId: "writers", name: "Writers", memberIds: ["bob"], actionPermission: { mode: "none" as const } },
    ],
  };
  const updated = replacePermissionGroupMembers(state, "readers", ["bob"]);
  expect(updated.groups).toMatchObject([
    { groupId: "readers", memberIds: ["bob"] },
    { groupId: "writers", memberIds: [] },
  ]);
  const serialized = serializeConnectionPermissionGroups({ billing: { enabled: true } }, target, updated);
  expect(serialized.policy.billing).toEqual({ enabled: true });
});

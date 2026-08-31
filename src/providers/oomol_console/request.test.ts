import { describe, expect, it, vi } from "vitest";
import { requestOomolConsole } from "./request.ts";

const endpoints = {
  api: "https://api.oomol.test",
  connector: "https://connector.oomol.test",
  insight: "https://insight.oomol.test",
  relationControl: "https://relation-control.oomol.test",
};

describe("OOMOL Console request", () => {
  it("使用 Bearer Token、team header 和 JSON body 调用 connector endpoint", async () => {
    const fetcher = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toBe("https://connector.oomol.test/v1/permissions?revision=3");
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer api-key");
      expect(headers.get("x-oo-team-id")).toBe("team-1");
      expect(headers.get("content-type")).toBe("application/json");
      expect(init?.method).toBe("PUT");
      expect(JSON.parse(String(init?.body))).toEqual({ userId: "user-supplied" });
      return Response.json({ ok: true, extra: "preserved" });
    });

    await expect(
      requestOomolConsole({
        endpoints,
        endpoint: "connector",
        path: "/v1/permissions",
        accessToken: "api-key",
        fetcher: fetcher as typeof fetch,
        method: "PUT",
        query: { revision: 3 },
        body: { userId: "user-supplied" },
        teamId: "team-1",
      }),
    ).resolves.toEqual({ ok: true, extra: "preserved" });
  });

  it("不会给非 connector endpoint 添加 team header", async () => {
    const fetcher = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).has("x-oo-team-id")).toBe(false);
      return Response.json({ ok: true });
    });

    await requestOomolConsole({
      endpoints,
      endpoint: "api",
      path: "/v1/me",
      accessToken: "api-key",
      fetcher: fetcher as typeof fetch,
      teamId: "team-1",
    });
  });

  it("保留上游 429 状态和消息并接受额外响应字段", async () => {
    const fetcher = vi.fn(async () => Response.json({ message: "slow down", requestId: "request-1" }, { status: 429 }));

    await expect(
      requestOomolConsole({
        endpoints,
        endpoint: "api",
        path: "/v1/me",
        accessToken: "api-key",
        fetcher: fetcher as typeof fetch,
      }),
    ).rejects.toMatchObject({
      status: 429,
      message: "slow down",
    });
  });
});

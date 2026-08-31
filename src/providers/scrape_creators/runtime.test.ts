import { describe, expect, it, vi } from "vitest";
import { scrapeCreatorsActionHandlers, validateScrapeCreatorsCredential } from "./runtime.ts";

describe("Scrape Creators runtime", () => {
  it("使用 x-api-key 获取余额并保留宽松的上游响应", async () => {
    const fetcher = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.scrapecreators.com/v1/account/credit-balance");
      expect(new Headers(init?.headers).get("x-api-key")).toBe("test-key");
      return Response.json({ creditCount: 42, plan: "starter" });
    });

    await expect(
      scrapeCreatorsActionHandlers.get_credit_balance(
        {},
        {
          apiKey: "test-key",
          fetcher: fetcher as typeof fetch,
        },
      ),
    ).resolves.toEqual({
      balance: 42,
      raw: { creditCount: 42, plan: "starter" },
    });
  });

  it("校验凭证时保留不同上游余额字段的兼容读取", async () => {
    const fetcher = vi.fn(async () => Response.json({ credits_remaining: 7, extra: true }));

    await expect(validateScrapeCreatorsCredential("test-key", fetcher as typeof fetch)).resolves.toMatchObject({
      metadata: { creditBalance: 7 },
    });
  });

  it("把校验阶段的 401 映射为 invalid_input", async () => {
    const fetcher = vi.fn(async () => Response.json({ message: "bad key", extra: "ignored" }, { status: 401 }));

    await expect(validateScrapeCreatorsCredential("bad-key", fetcher as typeof fetch)).rejects.toMatchObject({
      status: 401,
      code: "invalid_input",
      message: "bad key",
    });
  });
});

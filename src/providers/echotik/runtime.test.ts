import { describe, expect, it, vi } from "vitest";
import { echotikActionHandlers, requestEchoTikCredentialValidation } from "./runtime.ts";

const context = {
  username: "api-user",
  password: "api-password",
  fetcher: fetch,
};

describe("EchoTik runtime", () => {
  it("使用 Basic 鉴权请求分类并宽松归一化上游字段", async () => {
    const fetcher = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toBe("https://open.echotik.live/api/v3/echotik/category/l1?language=en-US");
      expect(new Headers(init?.headers).get("authorization")).toBe(
        `Basic ${Buffer.from("api-user:api-password").toString("base64")}`,
      );
      return Response.json({
        code: 0,
        requestId: "request-1",
        data: [{ category_id: "10", category_name: "Beauty", extra: "ignored" }],
      });
    });

    await expect(
      echotikActionHandlers.list_product_categories(
        { level: 1, language: "en-US" },
        { ...context, fetcher: fetcher as typeof fetch },
      ),
    ).resolves.toEqual({
      items: [{ categoryId: "10", name: "Beauty" }],
      requestId: "request-1",
    });
  });

  it("校验凭证时把上游鉴权失败映射为 invalid_input", async () => {
    const fetcher = vi.fn(async () => Response.json({ code: 401, message: "unauthorized" }, { status: 401 }));

    await expect(
      requestEchoTikCredentialValidation({ ...context, fetcher: fetcher as typeof fetch }),
    ).rejects.toMatchObject({
      status: 400,
      code: "invalid_input",
      message: "unauthorized",
    });
  });

  it("执行阶段保留 rate limit 错误语义", async () => {
    const fetcher = vi.fn(async () => Response.json({ code: 429, message: "quota exceeded" }, { status: 429 }));

    await expect(
      echotikActionHandlers.list_product_categories(
        { level: 1, language: "en-US" },
        { ...context, fetcher: fetcher as typeof fetch },
      ),
    ).rejects.toMatchObject({
      status: 429,
      code: "rate_limited",
    });
  });
});

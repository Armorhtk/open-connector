import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { beforeEach, expect, test, vi } from "vitest";
import { withMcpClient } from "./mcp-client.ts";

const mocks = vi.hoisted(() => ({
  connect: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: vi.fn(function Client() {
    return { connect: mocks.connect, close: mocks.close };
  }),
}));
vi.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: vi.fn(function SSEClientTransport() {}),
}));
vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: vi.fn(function StreamableHTTPClientTransport() {}),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.connect.mockResolvedValue(undefined);
});

test("共享 MCP client 按显式配置选择 SSE transport 并保留连接参数", async () => {
  const signal = new AbortController().signal;
  const headers = { authorization: "Bearer token" };

  await expect(
    withMcpClient(
      {
        endpoint: new URL("https://example.com/sse"),
        transport: "sse",
        headers,
        signal,
      },
      async () => "connected",
    ),
  ).resolves.toBe("connected");

  expect(SSEClientTransport).toHaveBeenCalledWith(new URL("https://example.com/sse"), {
    fetch: undefined,
    requestInit: { headers, redirect: undefined, signal },
  });
  expect(StreamableHTTPClientTransport).not.toHaveBeenCalled();
  expect(Client).toHaveBeenCalledWith(
    { name: "open-connector", version: "1.0.0" },
    { jsonSchemaValidator: expect.anything() },
  );
  expect(mocks.connect).toHaveBeenCalledWith(expect.anything(), { timeout: 60_000, signal });
  expect(mocks.close).toHaveBeenCalledOnce();
});

test("共享 MCP client 使用 Streamable HTTP 并保留调用方错误映射", async () => {
  const upstreamError = new Error("upstream failed");
  const mappedError = new Error("mapped error");
  const mapError = vi.fn(() => mappedError);
  mocks.connect.mockRejectedValue(upstreamError);

  await expect(
    withMcpClient(
      {
        endpoint: new URL("https://example.com/mcp"),
        transport: "streamable_http",
        mapError,
      },
      async () => undefined,
    ),
  ).rejects.toBe(mappedError);

  expect(StreamableHTTPClientTransport).toHaveBeenCalledOnce();
  expect(SSEClientTransport).not.toHaveBeenCalled();
  expect(mapError).toHaveBeenCalledWith(upstreamError);
  expect(mocks.close).toHaveBeenCalledOnce();
});

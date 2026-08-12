import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";

const mcpConnectTimeoutMs = 60_000;
const mcpJsonSchemaValidator = new CfWorkerJsonSchemaValidator();

export type McpHttpTransport = "streamable_http" | "sse";

export interface McpClientOptions {
  endpoint: URL;
  transport: McpHttpTransport;
  fetcher?: typeof fetch;
  headers?: HeadersInit;
  redirect?: RequestRedirect;
  signal?: AbortSignal;
  mapError?: (error: unknown) => unknown;
}

export async function withMcpClient<T>(options: McpClientOptions, run: (client: Client) => Promise<T>): Promise<T> {
  const transportOptions = {
    fetch: options.fetcher,
    requestInit: {
      headers: options.headers,
      redirect: options.redirect,
      signal: options.signal,
    },
  };
  const transport =
    options.transport === "sse"
      ? new SSEClientTransport(options.endpoint, transportOptions)
      : new StreamableHTTPClientTransport(options.endpoint, transportOptions);
  const client = new Client(
    { name: "open-connector", version: "1.0.0" },
    { jsonSchemaValidator: mcpJsonSchemaValidator },
  );

  try {
    await client.connect(transport, { timeout: mcpConnectTimeoutMs, signal: options.signal });
    return await run(client);
  } catch (error) {
    throw options.mapError ? options.mapError(error) : error;
  } finally {
    await client.close().catch(() => undefined);
  }
}

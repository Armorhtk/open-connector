import type { TikHubEndpointMethod } from "./endpoint-policy.ts";

export interface TikHubLlmsIndexEntry {
  endpointId: string;
  category: string;
  title: string;
  description: string;
  documentationUrl: string;
}

export interface TikHubDiscoveredEndpoint extends TikHubLlmsIndexEntry {
  operationId: string;
  method: TikHubEndpointMethod;
  path: string;
  requiredScope: string;
  contractHash: string;
  requestSchema: Record<string, unknown>;
}

export interface TikHubDiscoverInput {
  query?: string;
  category?: string;
  cursor?: string | null;
  limit?: number;
}

export interface TikHubDiscoverResult {
  catalogVersion: string;
  endpoints: TikHubDiscoveredEndpoint[];
  nextCursor: string | null;
  stale: boolean;
}

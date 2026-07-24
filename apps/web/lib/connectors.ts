/** Connecting tools to the AI employees.
 *
 *  A connector makes a tool *available*; it does not grant access. An employee
 *  still reaches it only if it declared the app and the run holds the
 *  permission — the same two gates as a native tool.
 */
import { apiClient } from "./api";

export interface ConnectorUser {
  id: string;
  name: string;
  role: string;
  icon: string;
  department: string;
}

export interface ConnectorInfo {
  app: string;
  label: string;
  permission: string;
  transport: "http" | "stdio";
  /** Configured by deployment environment rather than in the app. */
  fromEnvironment: boolean;
  connected: boolean;
  enabled: boolean;
  url: string;
  hasToken: boolean;
  lastStatus: "ok" | "error" | null;
  lastError: string | null;
  lastCheckedAt: string | null;
  toolCount: string | null;
  /** The employees that gain reach when this is connected. */
  usedBy: ConnectorUser[];
}

export interface ConnectorTest {
  ok: boolean;
  error: string | null;
  toolCount: number;
  tools: string[];
}

export function listConnectors(): Promise<{ connectors: ConnectorInfo[] }> {
  return apiClient.get("/connectors");
}

export function connectConnector(body: {
  app: string;
  url: string;
  token?: string;
}): Promise<{ app: string; connected: boolean; test: ConnectorTest }> {
  return apiClient.post("/connectors", body);
}

export function testConnector(app: string): Promise<ConnectorTest> {
  return apiClient.post(`/connectors/${app}/test`, {});
}

export function toggleConnector(
  app: string,
  enabled: boolean,
): Promise<{ app: string; enabled: boolean }> {
  return apiClient.patch(`/connectors/${app}`, { enabled });
}

export function disconnectConnector(app: string): Promise<{ ok: boolean }> {
  return apiClient.delete(`/connectors/${app}`);
}

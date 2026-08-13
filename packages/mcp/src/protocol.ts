import { z } from 'zod';

/**
 * MCP protocol subset (specification 2025-06-18): JSON-RPC 2.0 over
 * newline-delimited stdio. We implement the core lifecycle plus
 * tools/resources; the boundary is zod-validated in both directions.
 */

export const MCP_PROTOCOL_VERSION = '2025-06-18';

export const InitializeRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]),
  method: z.literal('initialize'),
  params: z.object({
    protocolVersion: z.string(),
    capabilities: z.record(z.string(), z.unknown()).default({}),
    clientInfo: z.object({ name: z.string(), version: z.string().optional() }).optional(),
  }),
});

export const CallToolRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]),
  method: z.literal('tools/call'),
  params: z.object({ name: z.string(), arguments: z.record(z.string(), z.unknown()).default({}) }),
});

export const ResourceReadRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]),
  method: z.literal('resources/read'),
  params: z.object({ uri: z.string() }),
});

/** Notifications MUST NOT carry an id; strict parsing keeps requests from matching. */
export const NotificationSchema = z
  .object({
    jsonrpc: z.literal('2.0'),
    method: z.string(),
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

/**
 * A tool's input schema, expressed as a plain JSON Schema fragment
 * (the subset we need: type, properties, required, items, enum).
 */
export type JsonSchema = Record<string, unknown>;

export interface McpTool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  handler: (args: Record<string, unknown>) => Promise<{ text: string }> | { text: string };
}

export interface McpResource {
  uri: string;
  name: string;
  mimeType?: string;
  read: () => string;
}

export interface McpServerInfo {
  name: string;
  version: string;
}

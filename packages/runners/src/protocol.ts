import { z } from 'zod';

/**
 * Language-neutral runner protocol, NDJSON-framed over stdio.
 *
 * Host -> runner requests carry an id; runner -> host messages are either
 * correlated responses ({id}) or unsolicited events (progress/log).
 * Binary media NEVER travels inside JSON: inputs and outputs are file
 * paths or content-addressed references resolvable by the host.
 */

export const PROTOCOL_VERSION = 1;

const fileRef = z.object({
  path: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});

export const DescribeRequestSchema = z.object({ id: z.string(), method: z.literal('describe') });
export const DescribeResponseSchema = z.object({
  id: z.string(),
  ok: z.literal(true),
  protocolVersion: z.literal(1),
  capabilities: z.array(z.string()),
  models: z.array(z.string()).default([]),
  runner: z.object({ name: z.string(), version: z.string() }),
});

export const PrepareRequestSchema = z.object({
  id: z.string(),
  method: z.literal('prepare'),
  params: z.object({
    capability: z.string(),
    modelId: z.string(),
    /** File references for weights/config; host resolves before spawn. */
    modelFiles: z.record(z.string(), fileRef).default({}),
    device: z.enum(['cuda', 'cpu', 'mlx', 'rocm']).optional(),
  }),
});

export const PrepareResponseSchema = z.object({
  id: z.string(),
  ok: z.literal(true),
  /** Free-form estimate the host can surface to the Job Center. */
  estimate: z.object({ seconds: z.number().optional(), note: z.string().optional() }).default({}),
});

export const ExecuteRequestSchema = z.object({
  id: z.string(),
  method: z.literal('execute'),
  params: z.object({
    capability: z.string(),
    modelId: z.string(),
    inputs: z.record(z.string(), fileRef).default({}),
    settings: z.record(z.string(), z.unknown()).default({}),
    /** Output directory the runner must write artifacts into. */
    outputDir: z.string().min(1),
  }),
});

export const ExecuteResponseSchema = z.object({
  id: z.string(),
  ok: z.literal(true),
  outputs: z.record(z.string(), fileRef),
  /** Optional per-output media metadata the host can fold into assets. */
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const ErrorResponseSchema = z.object({
  id: z.string(),
  ok: z.literal(false),
  error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean().default(false) }),
});

export const CancelRequestSchema = z.object({ id: z.string(), method: z.literal('cancel') });
export const HealthRequestSchema = z.object({ id: z.string(), method: z.literal('health') });
export const DisposeRequestSchema = z.object({ id: z.string(), method: z.literal('dispose') });

export const RunnerEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('progress'), stage: z.string(), progress: z.number().min(0).max(1).optional(), message: z.string().optional() }),
  z.object({ kind: z.literal('log'), level: z.enum(['debug', 'info', 'warn', 'error']), message: z.string() }),
  z.object({ kind: z.literal('cancelled') }),
]);

export type DescribeResponse = z.infer<typeof DescribeResponseSchema>;
export type PrepareResponse = z.infer<typeof PrepareResponseSchema>;
export type ExecuteResponse = z.infer<typeof ExecuteResponseSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
export type RunnerEvent = z.infer<typeof RunnerEventSchema>;
export type FileRef = z.infer<typeof fileRef>;

export type RunnerResponse = DescribeResponse | PrepareResponse | ExecuteResponse | ErrorResponse;

export type HostRequest =
  | z.infer<typeof DescribeRequestSchema>
  | z.infer<typeof PrepareRequestSchema>
  | z.infer<typeof ExecuteRequestSchema>
  | z.infer<typeof CancelRequestSchema>
  | z.infer<typeof HealthRequestSchema>
  | z.infer<typeof DisposeRequestSchema>;

/** Frame a JSON message as one NDJSON line. */
export function frame(message: unknown): string {
  return JSON.stringify(message) + '\n';
}

export const MAX_MESSAGE_BYTES = 4 * 1024 * 1024;

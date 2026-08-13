/**
 * Device graph: zod-validated runtime facts about this machine.
 *
 * Everything here is PROBED, never assumed from brand or platform:
 * absence (no nvidia-smi, no uv) is data, not an error. The graph is
 * ephemeral runtime diagnostics - not durable project state - so it
 * lives in this package instead of the Video IR schemas.
 */
import { z } from 'zod';

export const RuntimeNameSchema = z.enum(['ffmpeg', 'ffprobe', 'node', 'uv', 'python']);
export type RuntimeName = z.infer<typeof RuntimeNameSchema>;

export const RuntimeInfoSchema = z.object({
  name: RuntimeNameSchema,
  /** Parsed version string, e.g. '0.11.7'. */
  version: z.string(),
  /** The command that discovered it, e.g. 'python' or 'py -3'. */
  command: z.string(),
});
export type RuntimeInfo = z.infer<typeof RuntimeInfoSchema>;

export const GpuVendorSchema = z.enum(['nvidia', 'amd', 'intel', 'apple', 'unknown']);
export type GpuVendor = z.infer<typeof GpuVendorSchema>;

export const GpuInfoSchema = z.object({
  vendor: GpuVendorSchema,
  name: z.string(),
  vramBytes: z.number().int().nonnegative().optional(),
  driverVersion: z.string().optional(),
  cudaVersion: z.string().optional(),
});
export type GpuInfo = z.infer<typeof GpuInfoSchema>;

export const EncoderInfoSchema = z.object({
  name: z.string(),
  codec: z.string(),
  hardware: z.boolean(),
});
export type EncoderInfo = z.infer<typeof EncoderInfoSchema>;

export const OsInfoSchema = z.object({
  platform: z.string(),
  arch: z.string(),
  release: z.string(),
  nodeVersion: z.string(),
  cpuModel: z.string(),
  logicalCores: z.number().int().positive(),
  parallelism: z.number().int().positive(),
  totalMemoryBytes: z.number().int().nonnegative(),
});
export type OsInfo = z.infer<typeof OsInfoSchema>;

export const DeviceCapabilitiesSchema = z.object({
  /** Some h264/hevc encoder is available (software or hardware). */
  videoEncode: z.boolean(),
  /** A hardware h264/hevc encoder was actually probed. */
  hardwareVideoEncode: z.boolean(),
  /** uv or python is available, so isolated AI runners can be set up. */
  aiRunners: z.boolean(),
});
export type DeviceCapabilities = z.infer<typeof DeviceCapabilitiesSchema>;

export const DeviceGraphSchema = z.object({
  /** ISO timestamp of the probe. */
  probedAt: z.string(),
  os: OsInfoSchema,
  gpus: z.array(GpuInfoSchema),
  /** null when ffmpeg could not be probed. */
  ffmpegVersion: z.string().nullable(),
  encoders: z.array(EncoderInfoSchema),
  runtimes: z.array(RuntimeInfoSchema),
  capabilities: DeviceCapabilitiesSchema,
  /** Anomalies while probing (e.g. nvidia-smi ran but returned nothing). */
  warnings: z.array(z.string()),
});
export type DeviceGraph = z.infer<typeof DeviceGraphSchema>;

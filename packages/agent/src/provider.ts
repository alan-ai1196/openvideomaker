export interface LlmProviderConfig {
  provider: 'orcarouter' | 'custom';
  endpoint: string;
  model: string;
  apiKey?: string;
}

/** OrcaRouter's official OpenAI-compatible endpoint (overridable). */
export const ORCAROUTER_DEFAULT_BASE_URL = 'https://api.orcarouter.ai/v1';

/**
 * Resolve the LLM provider configuration from the environment. Two
 * optional presets, mutually exclusive:
 *
 * - the generic OpenAI-compatible preset (OVM_LLM_ENDPOINT +
 *   OVM_LLM_MODEL, optional OVM_LLM_API_KEY) - wins when present;
 * - the OrcaRouter preset (ORCAROUTER_API_KEY + ORCAROUTER_MODEL,
 *   optional ORCAROUTER_BASE_URL defaulting to the official endpoint).
 *
 * Both feed the SAME LlmPlanner; there is no OrcaRouter-specific request
 * path, only a different endpoint/key/model. Returns null when nothing
 * is configured - callers keep their honest unconfigured default.
 */
export function resolveLlmConfigFromEnv(env: Record<string, string | undefined>): LlmProviderConfig | null {
  const endpoint = env.OVM_LLM_ENDPOINT;
  const model = env.OVM_LLM_MODEL;
  if (endpoint && model) {
    return { provider: 'custom', endpoint, model, apiKey: env.OVM_LLM_API_KEY };
  }
  const orcaKey = env.ORCAROUTER_API_KEY;
  const orcaModel = env.ORCAROUTER_MODEL;
  if (orcaKey && orcaModel) {
    return {
      provider: 'orcarouter',
      endpoint: env.ORCAROUTER_BASE_URL ?? ORCAROUTER_DEFAULT_BASE_URL,
      model: orcaModel,
      apiKey: orcaKey,
    };
  }
  return null;
}

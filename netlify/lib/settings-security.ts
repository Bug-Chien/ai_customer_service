export const secretFields = ['gpt_api_key', 'gemini_api_key', 'line_channel_access_token', 'line_channel_secret'] as const;

const textFields = new Set(['active_ai', 'gpt_model_name', 'gpt_reasoning_effort', 'gpt_verbosity', 'gemini_model_name', 'gemini_thinking_level', 'system_prompt', 'reference_text', 'reference_file_url', 'handover_keywords', 'agent_user_ids']);
const numericFields = new Set(['gpt_temperature', 'gpt_max_tokens', 'gemini_temperature', 'gemini_max_tokens', 'handover_timeout_minutes']);

export function isAdmin(user: { app_metadata?: Record<string, unknown> } | null | undefined) {
  return user?.app_metadata?.role === 'admin';
}

export function publicSettings(row: Record<string, unknown>) {
  // An allowlist also prevents newly added database secrets from leaking by default.
  const safe: Record<string, unknown> = {};
  for (const key of ['id', 'updated_at', 'is_ai_enabled', ...textFields, ...numericFields]) {
    if (Object.hasOwn(row, key)) safe[key] = row[key];
  }
  safe.configured_secrets = secretFields.filter(key => Boolean(row[key]));
  return safe;
}

export function settingsUpdate(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid settings');
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (textFields.has(key)) {
      if (typeof value !== 'string' || value.length > 100000) throw new Error('Invalid setting');
      out[key] = value;
    } else if (numericFields.has(key)) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1000000) throw new Error('Invalid setting');
      out[key] = value;
    } else if (key === 'is_ai_enabled') {
      if (typeof value !== 'boolean') throw new Error('Invalid setting');
      out[key] = value;
    } else if ((secretFields as readonly string[]).includes(key)) {
      if (typeof value !== 'string' || value.length > 10000) throw new Error('Invalid secret');
      // Empty password inputs retain existing credentials; GET never returns them.
      if (value.trim()) out[key] = value.trim();
    }
    // Ignore id, creation/update timestamps, configured flags and unknown properties.
  }
  out.updated_at = new Date().toISOString();
  return out;
}

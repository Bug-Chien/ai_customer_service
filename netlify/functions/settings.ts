import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { isAdmin, publicSettings, settingsUpdate } from '../lib/settings-security';

type Request = { httpMethod: string; headers: Record<string, string | undefined>; body: string | null; isBase64Encoded?: boolean };
const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Pragma': 'no-cache' };
const reply = (statusCode: number, data: unknown) => ({ statusCode, headers, body: JSON.stringify(data) });

export function createSettingsHandler(clientFactory: () => SupabaseClient) {
  return async (event: Request) => {
    if (!['GET', 'PATCH'].includes(event.httpMethod)) return reply(405, { error: 'Method not allowed' });
    const authorization = event.headers.authorization || event.headers.Authorization || '';
    const match = /^Bearer (\S+)$/.exec(authorization);
    if (!match) return reply(401, { error: 'Sign in required' });

    try {
      const client = clientFactory();
      // Validate against Auth on every request, including current server-controlled metadata.
      const { data: { user }, error: authError } = await client.auth.getUser(match[1]);
      if (authError || !user) return reply(401, { error: 'Invalid session' });
      if (!isAdmin(user)) return reply(403, { error: 'Administrator access required' });

      let update: Record<string, unknown> | undefined;
      if (event.httpMethod === 'PATCH') {
        if (event.isBase64Encoded || Buffer.byteLength(event.body || '', 'utf8') > 200000) return reply(413, { error: 'Request too large' });
        try { update = settingsUpdate(JSON.parse(event.body || '')); }
        catch { return reply(400, { error: 'Invalid settings' }); }
      }

      const { data: row, error } = await client.from('settings').select('*').single();
      if (error || !row) return reply(500, { error: 'Unable to load settings' });
      if (update) {
        const { error: saveError } = await client.from('settings').update(update).eq('id', row.id);
        if (saveError) return reply(500, { error: 'Unable to save settings' });
      }
      return reply(200, { settings: publicSettings({ ...row, ...update }) });
    } catch {
      // Do not put provider/database errors or credentials in responses or logs.
      return reply(503, { error: 'Settings service unavailable' });
    }
  };
}

export const handler = createSettingsHandler(() => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing server configuration');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
});

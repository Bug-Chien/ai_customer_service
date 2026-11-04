import { supabase } from './supabase';

export async function settingsRequest(update?: Record<string, unknown>) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('請先登入');
  const response = await fetch('/.netlify/functions/settings', {
    method: update ? 'PATCH' : 'GET',
    headers: { Authorization: `Bearer ${session.access_token}`, ...(update ? { 'Content-Type': 'application/json' } : {}) },
    ...(update ? { body: JSON.stringify(update) } : {}),
    cache: 'no-store',
  });
  const data = await response.json();
  if (!response.ok) throw new Error(response.status === 403 ? '此帳號沒有管理員權限' : '無法讀取或儲存設定，請稍後再試');
  return data.settings;
}

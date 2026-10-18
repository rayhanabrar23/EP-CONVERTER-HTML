import { SESSION_TTL, checkLogin, cookieHeader, json, loadUsers, signSession } from '../_lib/auth.js';

export async function onRequestPost({ request, env }) {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) return json({ error: 'Server belum dikonfigurasi (SESSION_SECRET).' }, 500);
  let body; try { body = await request.json(); } catch { return json({ error: 'Permintaan tidak valid' }, 400); }
  const user = await checkLogin(loadUsers(env), body.username, body.password);
  if (!user) { await new Promise((r) => setTimeout(r, 600)); return json({ error: 'Username atau password salah' }, 401); }
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL;
  const token = await signSession({ u: user.u, role: user.role, exp }, env.SESSION_SECRET);
  return json({ ok: true, user: user.u, role: user.role }, 200, { 'set-cookie': cookieHeader(token, SESSION_TTL) });
}

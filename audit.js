// Log audit perubahan angka. Disimpan permanen HANYA jika KV namespace "AUDIT" di-bind di Cloudflare Pages.
// Tanpa KV, log tetap ada di sesi browser dan dapat diunduh (CSV) dari aplikasi.
import { json } from '../_lib/auth.js';

export async function onRequestPost({ request, env, data }) {
  let b; try { b = await request.json(); } catch { return json({ error: 'Permintaan tidak valid' }, 400); }
  const entries = (Array.isArray(b.entries) ? b.entries : []).slice(0, 200).map((e) => ({
    ts: String(e.ts || new Date().toISOString()).slice(0, 40), kind: String(e.kind || '').slice(0, 20), sid: String(e.sid || '').slice(0, 40),
    from: e.from ?? null, to: e.to ?? null, note: String(e.note || '').slice(0, 200), user: data.user.u, // user selalu dari sesi server, bukan dari klien
  }));
  if (!env.AUDIT) return json({ stored: false, count: entries.length });
  const day = new Date().toISOString().slice(0, 10);
  await env.AUDIT.put(`audit:${day}:${Date.now()}:${crypto.randomUUID()}`, JSON.stringify(entries), { expirationTtl: 60 * 60 * 24 * 400 });
  return json({ stored: true, count: entries.length });
}
export async function onRequestGet({ env, data }) {
  if (data.user.role !== 'PEI') return json({ error: 'Tidak diizinkan' }, 403);
  if (!env.AUDIT) return json({ stored: false, entries: [] });
  const list = await env.AUDIT.list({ prefix: 'audit:', limit: 200 }); const out = [];
  for (const k of list.keys) out.push(...JSON.parse(await env.AUDIT.get(k.name) || '[]'));
  return json({ stored: true, entries: out });
}

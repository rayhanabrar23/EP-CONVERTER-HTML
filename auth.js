// Utilitas autentikasi untuk Cloudflare Pages Functions (WebCrypto, tanpa dependensi).
const enc = new TextEncoder();
export const COOKIE = '__Host-pei_session';
export const SESSION_TTL = 8 * 3600; // 8 jam

export const b64u = {
  enc: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0)),
};
const b64 = { dec: (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)) };

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
export function timingSafeEqual(a, b) {
  const x = new Uint8Array(a), y = new Uint8Array(b); let r = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) r |= (x[i] || 0) ^ (y[i] || 0);
  return r === 0;
}
export async function signSession(payload, secret) {
  const body = b64u.enc(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body));
  return body + '.' + b64u.enc(sig);
}
export async function verifySession(token, secret) {
  if (!token || !secret || secret.length < 32) return null;
  const [body, sig] = String(token).split('.');
  if (!body || !sig) return null;
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), b64u.dec(sig), enc.encode(body)).catch(() => false);
  if (!ok) return null;
  try {
    const p = JSON.parse(new TextDecoder().decode(b64u.dec(body)));
    return p.exp > Math.floor(Date.now() / 1000) ? p : null;
  } catch { return null; }
}
export function parseCookies(h) {
  const out = {}; for (const part of (h || '').split(';')) { const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim(); }
  return out;
}
export const cookieHeader = (token, maxAge) => `${COOKIE}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;

// PBKDF2-SHA256, 100.000 iterasi (batas WebCrypto di Cloudflare Workers)
export async function pbkdf2(password, saltBytes, iter = 100000) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations: iter }, key, 256);
}
/** users: array {u, role, salt(b64), hash(b64), iter?}. Selalu menghitung hash agar waktu respons tidak membocorkan keberadaan user. */
export async function checkLogin(users, username, password) {
  const user = users.find((x) => x.u.toLowerCase() === String(username || '').toLowerCase());
  const salt = user ? b64.dec(user.salt) : crypto.getRandomValues(new Uint8Array(16));
  const got = await pbkdf2(String(password || ''), salt, user?.iter || 100000);
  if (!user) return null;
  return timingSafeEqual(got, b64.dec(user.hash)) ? { u: user.u, role: user.role || 'PEI' } : null;
}
export function loadUsers(env) { try { const u = JSON.parse(env.USERS_JSON || '[]'); return Array.isArray(u) ? u : []; } catch { return []; } }
export const json = (obj, status = 200, headers = {}) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });

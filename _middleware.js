// Gerbang untuk SEMUA permintaan (halaman, aset statis, API). Pengecekan login terjadi di server.
import { COOKIE, parseCookies, verifySession } from './_lib/auth.js';

const PUBLIC = new Set(['/login', '/login.html', '/login.css', '/login.js', '/api/login', '/favicon.ico']);

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  // Wajib HTTPS (Cloudflare sudah memaksa, ini pengaman tambahan)
  if (url.protocol === 'http:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') { url.protocol = 'https:'; return Response.redirect(url.toString(), 301); }

  // Proteksi CSRF: permintaan mengubah data harus berasal dari origin yang sama
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    const origin = request.headers.get('origin');
    if (origin && origin !== url.origin) return new Response('Forbidden', { status: 403 });
  }

  if (PUBLIC.has(path)) return withHeaders(await next());

  const session = await verifySession(parseCookies(request.headers.get('cookie'))[COOKIE], env.SESSION_SECRET);
  if (!session) {
    if (path.startsWith('/api/')) return new Response(JSON.stringify({ error: 'Belum login' }), { status: 401, headers: { 'content-type': 'application/json' } });
    return Response.redirect(url.origin + '/login', 302);
  }
  context.data.user = session;
  return withHeaders(await next());
}

function withHeaders(res) {
  const h = new Headers(res.headers);
  h.set('X-Content-Type-Options', 'nosniff'); h.set('X-Frame-Options', 'DENY'); h.set('Referrer-Policy', 'no-referrer');
  h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  h.set('Cache-Control', 'no-store');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

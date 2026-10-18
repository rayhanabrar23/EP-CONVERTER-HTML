import assert from 'node:assert'; import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { onRequest } from '../functions/_middleware.js'; import { onRequestPost as login } from '../functions/api/login.js';
import { onRequestPost as audit } from '../functions/api/audit.js';
import { signSession, COOKIE } from '../functions/_lib/auth.js';
const salt = randomBytes(16), pw = 'RahasiaPanjang123';
const users = [{ u: 'pei1', role: 'PEI', salt: salt.toString('base64'), hash: pbkdf2Sync(pw, salt, 100000, 32, 'sha256').toString('base64'), iter: 100000 }];
const env = { SESSION_SECRET: 'x'.repeat(40), USERS_JSON: JSON.stringify(users) };
const O = 'https://pei.example.com'; let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('  ✓', name); };
const next = async () => new Response('ISI HALAMAN', { status: 200 });
const mw = (path, headers = {}, method = 'GET') => onRequest({ request: new Request(O + path, { method, headers }), env, next, data: {} });
const doLogin = (body) => login({ request: new Request(O + '/api/login', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }), env });

let cookie;
await t('halaman utama tanpa login → redirect ke /login', async () => { const r = await mw('/'); assert.strictEqual(r.status, 302); assert.match(r.headers.get('location'), /\/login$/); });
await t('aset JS aplikasi tanpa login juga diblok (kode tidak bocor)', async () => assert.strictEqual((await mw('/app.js')).status, 302));
await t('API tanpa login → 401 JSON', async () => assert.strictEqual((await mw('/api/me')).status, 401));
await t('halaman /login terbuka tanpa login', async () => assert.strictEqual((await mw('/login')).status, 200));
await t('password salah → 401, tidak ada cookie', async () => { const r = await doLogin({ username: 'pei1', password: 'salah' }); assert.strictEqual(r.status, 401); assert.strictEqual(r.headers.get('set-cookie'), null); });
await t('username tidak ada → 401 (pesan sama)', async () => { const r = await doLogin({ username: 'hantu', password: pw }); assert.strictEqual(r.status, 401); assert.match((await r.json()).error, /salah/); });
await t('login benar → cookie HttpOnly+Secure+SameSite=Strict', async () => {
  const r = await doLogin({ username: 'PEI1', password: pw }); assert.strictEqual(r.status, 200);
  const sc = r.headers.get('set-cookie'); assert.match(sc, /HttpOnly/); assert.match(sc, /Secure/); assert.match(sc, /SameSite=Strict/); assert.match(sc, /^__Host-/);
  cookie = sc.split(';')[0];
});
await t('dengan cookie valid → halaman terbuka + header keamanan', async () => { const r = await mw('/', { cookie }); assert.strictEqual(r.status, 200); assert.strictEqual(r.headers.get('x-frame-options'), 'DENY'); });
await t('cookie dimodifikasi (ubah role) → ditolak', async () => {
  const [name, val] = cookie.split('='); const [body, sig] = val.split('.');
  const p = JSON.parse(Buffer.from(body, 'base64url').toString()); p.role = 'ADMIN';
  const forged = Buffer.from(JSON.stringify(p)).toString('base64url') + '.' + sig; assert.strictEqual((await mw('/', { cookie: `${name}=${forged}` })).status, 302);
});
await t('cookie kedaluwarsa → ditolak', async () => { const tok = await signSession({ u: 'pei1', role: 'PEI', exp: 1000 }, env.SESSION_SECRET); assert.strictEqual((await mw('/', { cookie: `${COOKIE}=${tok}` })).status, 302); });
await t('cookie bertanda tangan secret lain → ditolak', async () => { const tok = await signSession({ u: 'pei1', role: 'PEI', exp: 9999999999 }, 'y'.repeat(40)); assert.strictEqual((await mw('/', { cookie: `${COOKIE}=${tok}` })).status, 302); });
await t('POST dari origin lain (CSRF) → 403', async () => assert.strictEqual((await mw('/api/audit', { cookie, origin: 'https://jahat.example' }, 'POST')).status, 403));
await t('SESSION_SECRET pendek/tidak ada → login ditolak server', async () => { const r = await login({ request: new Request(O + '/api/login', { method: 'POST', body: '{}' }), env: { ...env, SESSION_SECRET: 'pendek' } }); assert.strictEqual(r.status, 500); });
await t('audit: nama user diambil dari sesi, bukan dari klien', async () => {
  const r = await audit({ request: new Request(O + '/api/audit', { method: 'POST', body: JSON.stringify({ entries: [{ kind: 'RP', sid: 'S1', user: 'PALSU', from: 1, to: 2 }] }) }), env, data: { user: { u: 'pei1' } } });
  assert.deepStrictEqual(await r.json(), { stored: false, count: 1 });
  let saved; await audit({ request: new Request(O + '/api/audit', { method: 'POST', body: JSON.stringify({ entries: [{ kind: 'RP', sid: 'S1', user: 'PALSU' }] }) }), env: { ...env, AUDIT: { put: async (_, v) => (saved = JSON.parse(v)) } }, data: { user: { u: 'pei1' } } });
  assert.strictEqual(saved[0].user, 'pei1');
});
console.log(`\n${n} tes auth lulus`);

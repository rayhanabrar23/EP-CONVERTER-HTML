import { cookieHeader, json } from '../_lib/auth.js';
export async function onRequestPost() { return json({ ok: true }, 200, { 'set-cookie': cookieHeader('', 0) }); }

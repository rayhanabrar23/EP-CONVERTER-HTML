import { json } from '../_lib/auth.js';
export async function onRequestGet({ data }) { return json({ user: data.user.u, role: data.user.role }); }

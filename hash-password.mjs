// Pakai:  node tools/hash-password.mjs <username> <ROLE: PEI|MNC>      (password diminta interaktif)
// Hasilnya: potongan JSON untuk env var USERS_JSON (gabungkan beberapa user dalam satu array).
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import readline from 'node:readline';
const [u, role = 'PEI'] = process.argv.slice(2);
if (!u) { console.error('Pakai: node tools/hash-password.mjs <username> <PEI|MNC>'); process.exit(1); }
const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
rl.question('Password (terlihat saat diketik): ', (pw) => {
  rl.close();
  if (pw.length < 10) { console.error('Minimal 10 karakter.'); process.exit(1); }
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(pw, salt, 100000, 32, 'sha256');
  console.log(JSON.stringify({ u, role: role.toUpperCase(), salt: salt.toString('base64'), hash: hash.toString('base64'), iter: 100000 }));
});

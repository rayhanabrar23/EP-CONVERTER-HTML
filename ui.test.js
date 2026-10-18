const fs = require('fs'), path = require('path'), assert = require('assert'); const { JSDOM } = require('jsdom');
const P = path.join(__dirname, '..', 'public'), D = path.join(__dirname, 'data');
const wait = (ms = 60) => new Promise((r) => setTimeout(r, ms));
async function boot(role) {
  const dom = new JSDOM(fs.readFileSync(P + '/index.html', 'utf8').replace(/<script[^>]*><\/script>/g, ''), { url: 'https://pei.test/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window; const calls = { audit: [], xlsx: [], csv: [] };
  w.fetch = async (u, o) => { if (u === '/api/me') return { ok: true, json: async () => ({ user: 'rayhan', role }) }; if (u === '/api/audit') { calls.audit.push(JSON.parse(o.body)); return { ok: true }; } return { ok: false }; };
  w.URL.createObjectURL = (b) => { calls.csv.push(b); return 'blob:x'; }; w.HTMLAnchorElement.prototype.click = function () {};
  for (const f of ['vendor/xlsx.full.min.js', 'core.js']) w.eval(fs.readFileSync(path.join(P, f), 'utf8'));
  w.XLSX.writeFile = (wb, name) => calls.xlsx.push({ wb, name });
  w.eval(fs.readFileSync(P + '/app.js', 'utf8')); await wait();
  return { w, d: w.document, calls };
}
async function upload(w, d, over = {}) {
  const map = { '1. Closing Price': 'closing.xlsx', '2. Risk Parameter': 'risk.txt', '3. Outstanding Position': 'op.txt', '4. List of Invoice': 'netting.csv', '5. Credit Limit': 'cl.txt', '6. SID Client (daftar nasabah PEI)': 'sidclient.xlsx', '7. Participant Stock Position': 'pos.txt', '8. Data Transaksi LR': 'lrsettle.txt' };
  for (const [label, file] of Object.entries(map)) {
    const inp = d.querySelector(`input[type=file][aria-label="${label}"]`); assert.ok(inp, label);
    Object.defineProperty(inp, 'files', { value: [new w.File([over[file] || fs.readFileSync(D + '/' + file)], file)], configurable: true });
    inp.dispatchEvent(new w.Event('change')); await wait(80);
  }
}
const tab = async (d, name) => { [...d.querySelectorAll('#tabs button')].find((b) => b.textContent === name).click(); await wait(); };
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('  ✓', name); };
(async () => {
  const { w, d, calls } = await boot('PEI');
  await t('tab selain Upload terkunci sebelum diproses', async () => assert.ok([...d.querySelectorAll('#tabs button')].filter((b) => b.textContent !== 'Upload').every((b) => b.disabled)));
  await upload(w, d);
  await t('tombol Proses aktif setelah 6 berkas wajib (csv netting diterima)', async () => { const b = [...d.querySelectorAll('button')].find((x) => x.textContent.includes('Proses')); assert.ok(!b.disabled); b.click(); await wait(200); });
  await t('masuk tab TRX PEI dengan tabel RP & LR terisi + pesan ringkasan', async () => { assert.ok(d.querySelector('#main table')); assert.match(d.getElementById('main').textContent, /Dimuat: \d+ SID di OP/); assert.ok(d.querySelectorAll('input.cell').length > 0); });
  const rpInput = () => d.querySelector('input.cell[aria-label^="RP Final"]');
  let sidEdited, before;
  await t('edit RP Final → tersimpan, ditandai, tercatat di audit & terkirim ke server', async () => {
    const inp = rpInput(); sidEdited = inp.getAttribute('aria-label').split(' ').pop(); before = Number(inp.value);
    inp.value = String(Math.round(before * 0.99)); inp.dispatchEvent(new w.Event('change')); await wait();
    const again = [...d.querySelectorAll('input.cell')].find((i) => i.getAttribute('aria-label') === `RP Final ${sidEdited}`);
    assert.strictEqual(Number(again.value), Math.round(before * 0.99)); assert.ok(again.className.includes('ed'));
    assert.ok(calls.audit.some((a) => a.entries.some((e) => e.sid === sidEdited && e.kind === 'RP')));
  });
  await t('editan RP muncul di file iFast Repayment (Bug 1 teratasi di UI)', async () => {
    await tab(d, 'Export iFast'); [...d.querySelectorAll('button')].find((b) => b.textContent.includes('Excel') ).click(); await wait();
    const wb = calls.xlsx.pop().wb; const rows = w.XLSX.utils.sheet_to_json(wb.Sheets['Repayment Direct']);
    const r = rows.find((x) => x['SID Client'] === sidEdited); assert.ok(r, 'SID hasil edit ada di file RP'); assert.strictEqual(r['Repayment Value'], Math.round(before * 0.99));
  });
  await t('tab Validasi menampilkan status Limit Participant', async () => { await tab(d, 'Validasi MNC'); assert.match(d.getElementById('main').textContent, /Limit Participant (LOLOS|GAGAL)/); });
  await t('Diagnostik: netting nol dijelaskan lewat UI', async () => {
    await tab(d, 'Kenapa tidak muncul?'); const sid = JSON.parse(fs.readFileSync(D + '/meta.json')).sids[5];
    const inp = d.querySelector('input[aria-label="Cari nasabah"]'); inp.value = sid; [...d.querySelectorAll('button')].find((b) => b.textContent === 'Telusuri').click(); await wait();
    assert.match(d.getElementById('main').textContent, /NETTING NOL/);
  });
  await t('Audit tab menampilkan perubahan dengan user dari sesi', async () => { await tab(d, 'Audit'); assert.match(d.getElementById('main').textContent, /rayhan/); assert.match(d.getElementById('main').textContent, new RegExp(sidEdited)); });
  await t('XSS: nama nasabah berisi HTML (diunggah lewat OP) tampil sebagai teks, bukan elemen', async () => {
    const evil = await boot('PEI'); const op = fs.readFileSync(D + '/op.txt', 'utf8').replace(/NASABAH \d+/g, '<img src=x onerror=alert(1)>');
    await upload(evil.w, evil.d, { 'op.txt': Buffer.from(op) });
    [...evil.d.querySelectorAll('button')].find((x) => x.textContent.includes('Proses')).click(); await wait(200);
    assert.ok(evil.d.querySelectorAll('#main table').length > 0); assert.strictEqual(evil.d.querySelectorAll('img').length, 0);
    assert.ok(evil.d.getElementById('main').textContent.includes('<img src=x onerror=alert(1)>'));
  });
  const mnc = await boot('MNC'); await upload(mnc.w, mnc.d);
  [...mnc.d.querySelectorAll('button')].find((x) => x.textContent.includes('Proses')).click(); await wait(200);
  await t('peran MNC: tidak ada kolom yang bisa diedit & Auto-Adjust nonaktif', async () => {
    assert.strictEqual(mnc.d.querySelectorAll('input.cell').length, 0); await tab(mnc.d, 'Validasi MNC');
    assert.ok([...mnc.d.querySelectorAll('button')].find((b) => b.textContent.includes('Auto-Adjust')).disabled);
  });
  console.log(`\n${n} tes UI lulus`); process.exit(0);
})().catch((e) => { console.error('GAGAL:', e.message); process.exit(1); });

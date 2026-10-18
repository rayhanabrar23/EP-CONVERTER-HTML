(() => {
  'use strict';
  const C = window.PEICore, X = window.XLSX;
  // ── helper DOM (selalu textContent → aman dari XSS walau nama nasabah berisi HTML) ──
  const h = (tag, props, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (v === true) el.setAttribute(k, ''); else if (v !== false && v != null) el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  };
  const $ = (id) => document.getElementById(id);
  const rp = (v) => (v == null ? '-' : C.fmtRp(v));
  const pct = (v) => (v == null ? '-' : C.fmtPct(v));
  const today = () => new Date().toISOString().slice(0, 10).replace(/-/g, '');

  const SLOTS = [
    { id: 'closing', label: '1. Closing Price', acc: '.xlsx', req: 1, kind: 'rows' },
    { id: 'risk', label: '2. Risk Parameter', acc: '.txt', req: 1, kind: 'text' },
    { id: 'op', label: '3. Outstanding Position', acc: '.txt', req: 1, kind: 'text' },
    { id: 'netting', label: '4. List of Invoice', acc: '.csv,.xls,.xlsx', req: 1, kind: 'rows' },
    { id: 'cl', label: '5. Credit Limit', acc: '.txt', req: 1, kind: 'text' },
    { id: 'sidclient', label: '6. SID Client (daftar nasabah PEI)', acc: '.xlsx', req: 1, kind: 'rows' },
    { id: 'pos', label: '7. Participant Stock Position', acc: '.txt', kind: 'text', hint: 'opsional — koreksi OP T+2 belum settle' },
    { id: 'lrsettle', label: '8. Data Transaksi LR', acc: '.txt', kind: 'text', hint: 'opsional — koreksi Loan Existing belum settle' },
    { id: 'hasil', label: '9. Hasil MNC (sheet LR)', acc: '.xlsx', kind: 'hasil', hint: 'opsional — untuk check LR-1; tanpa ini dipakai Available Qty Risk Parameter' },
  ];
  const S = { user: '-', role: 'PEI', files: {}, ctx: null, st: C.newState(), pei: null, mnc: null, tab: 'upload', msg: null, sent: 0 };
  const canEdit = () => S.role === 'PEI';

  const readFile = (f, kind) => new Promise((res, rej) => {
    const r = new FileReader(); r.onerror = () => rej(new Error('Gagal membaca ' + f.name));
    if (kind === 'text') { r.onload = () => res(String(r.result)); r.readAsText(f); return; }
    r.onload = () => {
      try {
        const wb = X.read(r.result, { type: 'array', raw: /\.csv$/i.test(f.name) });
        if (kind === 'hasil') {
          const name = wb.SheetNames.find((n) => n === 'Loan Request (LR)') || wb.SheetNames.find((n) => n === 'Buy (Loan)');
          if (!name) throw new Error('Sheet "Loan Request (LR)" tidak ada di Hasil MNC. Sheet tersedia: ' + wb.SheetNames.join(', '));
          const m = new Map(); X.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' }).slice(1).forEach((row) => { const k = String(row[0]); if (!m.has(k)) m.set(k, []); m.get(k).push(row); });
          return res(m);
        }
        res(X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: undefined }));
      } catch (e) { rej(e); }
    };
    r.readAsArrayBuffer(f);
  });

  // ── audit: lokal + kirim ke server (user dicatat server dari sesi) ──
  function audit() {
    const fresh = S.st.audit.slice(S.sent); if (!fresh.length) return; S.sent = S.st.audit.length;
    fetch('/api/audit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ entries: fresh }) }).catch(() => {});
  }
  const recompute = () => { S.pei = C.runPei(S.ctx, S.st); S.mnc = C.runMnc(S.ctx, S.st); };
  function edit(kind, sid, raw, d) {
    if (!canEdit()) return;
    const digits = String(raw).replace(/[^\d]/g, '');
    const val = digits === '' ? null : Number(digits);
    C.setOverride(S.st, kind, sid, val, S.user, val == null ? 'kembali ke rekomendasi' : 'edit manual'); audit(); recompute(); render();
  }
  const download = (name, blob) => { const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove(); };
  const xlsxOut = (name, sheets) => { const wb = X.utils.book_new(); for (const [n, rows] of Object.entries(sheets)) X.utils.book_append_sheet(wb, X.utils.json_to_sheet(rows), n); X.writeFile(wb, name); };
  const csvOut = (name, rows) => download(name, new Blob(['\ufeff' + C.toCsv(rows)], { type: 'text/csv;charset=utf-8' }));

  // ── tabel generik ──
  function table(cols, rows) {
    return h('div', { class: 'tw' }, h('table', {}, h('thead', {}, h('tr', {}, cols.map((c) => h('th', {}, c.t)))),
      h('tbody', {}, rows.map((r) => h('tr', {}, cols.map((c) => { const v = c.f(r); return h('td', { class: (c.n ? 'n ' : '') + (c.cls ? c.cls(r) : '') }, v); }))))));
  }
  const cell = (d, kind, field, label) => canEdit()
    ? h('span', {}, h('input', { class: 'cell' + (d[kind + '_edited'] ? ' ed' : ''), type: 'text', inputmode: 'numeric', 'aria-label': `${label} ${d.sid}`, value: Math.round(d[field]).toString(), onchange: (e) => edit(kind, d.sid, e.target.value, d) }),
      d[kind + '_edited'] ? h('button', { class: 'ghost', title: 'Kembalikan ke rekomendasi', onclick: () => edit(kind, d.sid, '', d) }, '↺') : null)
    : rp(d[field]);

  // ── tab Upload ──
  function viewUpload() {
    const grid = h('div', { class: 'grid' }, SLOTS.map((s) => h('div', { class: 'up' + (S.files[s.id] ? ' done' : '') },
      h('b', {}, s.label, s.req ? '' : ' (opsional)'), s.hint ? h('small', {}, s.hint) : null,
      h('input', { type: 'file', accept: s.acc, 'aria-label': s.label, onchange: async (e) => {
        const f = e.target.files[0]; if (!f) { delete S.files[s.id]; return render(); }
        try { S.files[s.id] = { name: f.name, data: await readFile(f, s.kind) }; S.msg = null; } catch (er) { S.msg = { er: 1, t: er.message }; delete S.files[s.id]; } render(); } }),
      S.files[s.id] ? h('div', { class: 'ok' }, '✓ ' + S.files[s.id].name) : null)));
    const ready = SLOTS.filter((s) => s.req).every((s) => S.files[s.id]);
    return h('div', {}, h('p', { class: 'mut' }, 'Berkas hanya diproses di browser Anda dan tidak diunggah ke server.'), grid,
      h('div', { class: 'row' }, h('button', { disabled: !ready, onclick: run }, '▶ Proses'), ready ? null : h('span', { class: 'mut' }, 'Lengkapi berkas wajib (1–6).')),
      S.msg ? h('div', { class: 'msg ' + (S.msg.er ? 'er' : '') }, S.msg.t) : null);
  }
  function run() {
    try {
      const f = (id) => S.files[id] && S.files[id].data;
      S.ctx = C.buildContext({ closingRows: f('closing'), riskText: f('risk'), opText: f('op'), nettingRows: f('netting'), clText: f('cl'), sidClientRows: f('sidclient'), posText: f('pos'), lrSettleText: f('lrsettle'), hasilBuyRows: f('hasil') });
      S.st = C.newState(); S.sent = 0; recompute(); S.tab = 'trx';
      const vd = S.ctx.clValueDate, td = new Date().toISOString().slice(0, 10).replace(/-/g, '/');
      S.msg = { t: `Dimuat: ${S.ctx.op.size} SID di OP, ${S.ctx.cp.size} harga saham, ${S.ctx.netting.size} SID di Netting, ${S.ctx.cl.size} di Credit Limit, ${S.ctx.peiSids.size} nasabah PEI.` + (vd && vd !== td ? ` ⚠️ Value Date Credit Limit ${vd} ≠ hari ini ${td}.` : '') };
    } catch (e) { S.msg = { er: 1, t: 'Gagal memproses: ' + e.message }; S.tab = 'upload'; }
    render();
  }

  // ── tab TRX PEI ──
  function viewTrx() {
    const rpRows = [...S.pei.values()].filter((d) => d.total_rp_maks > 0);
    const lrRows = [...S.pei.values()].filter((d) => d.total_buy_val > 0);
    const rpCols = [{ t: 'SID', f: (d) => d.sid }, { t: 'Nama', f: (d) => d.name },
      { t: 'Saham (lot keluar)', f: (d) => d.rp_detail.filter((x) => x.ada_di_op).map((x) => `${x.stock} (${Math.trunc(x.lot_keluar)})`).join(', ') },
      { t: 'Loan Existing', n: 1, f: (d) => rp(d.loan_existing) }, { t: 'RP Min (ref 65%)', n: 1, f: (d) => rp(d.total_rp_min_ratio) },
      { t: 'RP Max (rekomendasi)', n: 1, f: (d) => rp(d.total_rp_maks) }, { t: 'RP Final', f: (d) => cell(d, 'rp', 'rp_final', 'RP Final') }, { t: 'Rasio after RP', n: 1, f: (d) => pct(d.rasio_rp) }];
    const lrCols = [{ t: 'SID', f: (d) => d.sid }, { t: 'Nama', f: (d) => d.name },
      { t: 'Saham (lot beli)', f: (d) => Object.entries(d.buy_stocks).map(([s, b]) => `${s} (${Math.trunc(b.lot)})`).join(', ') },
      { t: 'Nilai Beli', n: 1, f: (d) => rp(d.total_buy_val) }, { t: 'RP Final', n: 1, f: (d) => rp(d.rp_final) }, { t: 'Avail Efektif', n: 1, f: (d) => rp(d.avail_efektif) },
      { t: 'LR @63%', n: 1, f: (d) => rp(d.max_lr_63) }, { t: 'Max LR (rekomendasi)', n: 1, f: (d) => rp(d.max_lr_final) }, { t: 'Binding', f: (d) => d.lr_binding },
      { t: 'LR Final', f: (d) => cell(d, 'lr', 'lr_final', 'LR Final') }, { t: 'Rasio LR', n: 1, f: (d) => pct(d.rasio_lr) }];
    return h('div', {}, S.msg ? h('div', { class: 'msg' }, S.msg.t) : null,
      h('p', { class: 'mut' }, canEdit() ? 'Ubah RP Final / LR Final lalu tekan Enter atau pindah sel. Nilai tersimpan dan dipakai di Validasi, file iFast, dan Hasil_TRX_PEI.' : 'Peran MNC: hanya lihat dan unduh.'),
      h('h3', {}, `Repayment (${rpRows.length} nasabah dari ${S.pei.size} PEI)`), rpRows.length ? table(rpCols, rpRows) : h('p', { class: 'mut' }, 'Tidak ada RP.'),
      h('h3', {}, `Loan Request (${lrRows.length})`), lrRows.length ? table(lrCols, lrRows) : h('p', { class: 'mut' }, 'Tidak ada LR.'));
  }

  // ── tab Validasi ──
  const mark = (ok, skipped) => (skipped ? '⏭' : ok ? '✅' : '❌');
  function viewVal() {
    const g = C.globalResult(S.mnc); const rows = [...S.mnc.values()].filter((d) => d.is_pei && (d.has_rp || d.has_lr));
    const failing = (d) => d.checks.filter((c) => !c.passed).map((c) => c.label.split('.')[0] + ': ' + c.detail).join(' | ');
    const needAdj = rows.filter((d) => d.has_lr && d.checks.some((c) => c.label === C.LR3 && !c.passed)).length;
    return h('div', {}, h('div', { class: 'msg ' + (g.passed ? 'ok' : 'er') }, (g.passed ? '✅ Limit Participant LOLOS — ' : '❌ Limit Participant GAGAL — ') + g.detail),
      h('div', { class: 'row' }, h('button', { disabled: !needAdj || !canEdit(), onclick: () => { C.applyAutoAdjust(S.st, S.mnc, S.user); audit(); recompute(); render(); } }, `⚡ Auto-Adjust LR (${needAdj} nasabah gagal LR-3)`),
        h('span', { class: 'mut' }, 'Nasabah yang gagal check tidak masuk file iFast sampai lolos.')),
      table([{ t: 'SID', f: (d) => d.sid }, { t: 'Nama', f: (d) => d.name },
        { t: 'RP Final', n: 1, f: (d) => (d.has_rp && !d.rp_skipped ? rp(d.rp_final) : '-') }, { t: 'RP', f: (d) => (d.has_rp ? mark(C.lolosRp(d), d.rp_skipped) : '-') },
        { t: 'LR Final', n: 1, f: (d) => (d.has_lr ? rp(d.lr_final) : '-') }, { t: 'LR', f: (d) => (d.has_lr ? mark(C.lolosLr(d)) : '-') },
        { t: 'Check yang gagal', f: (d) => failing(d), cls: () => 'er' }], rows));
  }

  // ── tab Export ──
  function viewExport() {
    const R = C.ifastRepayment(S.mnc), L = C.ifastLoan(S.mnc);
    const need = [...S.mnc.values()].filter((d) => d.is_pei && ((d.has_lr && !C.lolosLr(d) && d.lr_final > 0) || (d.has_rp && !d.rp_skipped && !C.lolosRp(d)))).length;
    const btn = (label, fn, n) => h('button', { disabled: !n, onclick: fn }, label);
    const block = (title, data, main, file) => h('div', { class: 'up' }, h('b', {}, `${title} — ${data[main].length} nasabah`),
      h('div', { class: 'row' }, btn('⬇️ Excel (.xlsx)', () => xlsxOut(`${file} ${today()}.xlsx`, data), data[main].length),
        btn('CSV (sheet utama)', () => csvOut(`${file} ${today()}.csv`, data[main]), data[main].length), btn('CSV (Stock)', () => csvOut(`${file} Stock ${today()}.csv`, data.Stock), data.Stock.length)));
    return h('div', {}, need ? h('div', { class: 'msg wr' }, `⚠️ ${need} nasabah punya transaksi tetapi TIDAK masuk file iFast karena gagal validasi. Lihat tab Validasi atau Diagnostik.`) : null,
      h('div', { class: 'grid' }, block('Repayment iFast', R, 'Repayment Direct', 'Repayment Proceed'), block('Loan Request iFast', L, 'Loan', 'Loan Request'),
        h('div', { class: 'up' }, h('b', {}, 'Hasil TRX PEI (untuk MNC)'), h('div', { class: 'row' }, h('button', { onclick: () => xlsxOut('Hasil_TRX_PEI.xlsx', C.hasilTrxPei(S.pei)) }, '⬇️ Hasil_TRX_PEI.xlsx')))),
      h('p', { class: 'mut' }, 'Semua file memakai nilai RP Final / LR Final terkini (termasuk hasil edit).'));
  }

  // ── tab Diagnostik ──
  let diagOut = null;
  function viewDiag() {
    const inp = h('input', { type: 'text', placeholder: 'SID, CID, atau nama nasabah (mis. Firbert)', 'aria-label': 'Cari nasabah' });
    const go = () => { diagOut = C.diagnoseSid(inp.value, S.ctx, S.mnc); render(); };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    const ico = { ok: '✅', warn: '⚠️', drop: '⛔' };
    return h('div', {}, h('p', { class: 'mut' }, 'Telusuri di tahap mana seorang nasabah gugur: SID Client → Netting → Closing Price → OP → Credit Limit → RP/LR → validasi → iFast.'),
      h('div', { class: 'row' }, inp, h('button', { onclick: go }, 'Telusuri')),
      diagOut ? h('div', {}, h('h3', {}, diagOut.sid ? `${diagOut.sid} — ${diagOut.verdict}` : diagOut.verdict),
        table([{ t: '', f: (s) => ico[s.status] }, { t: 'Tahap', f: (s) => s.stage }, { t: 'Keterangan', f: (s) => s.msg, cls: (s) => (s.status === 'drop' ? 'er' : s.status === 'warn' ? 'wr' : '') }], diagOut.stages)) : null);
  }

  // ── tab Audit ──
  function viewAudit() {
    const rows = S.st.audit.map((a) => ({ Waktu: a.ts, User: a.user, Jenis: a.kind, SID: a.sid, Dari: a.from, Ke: a.to, Catatan: a.note }));
    return h('div', {}, h('div', { class: 'row' }, h('button', { disabled: !rows.length, onclick: () => csvOut(`Audit PEI ${today()}.csv`, rows) }, '⬇️ Unduh log (CSV)'),
      h('span', { class: 'mut' }, 'Log sesi ini. Penyimpanan permanen di server aktif jika KV "AUDIT" dipasang.')),
      rows.length ? table(Object.keys(rows[0]).map((k) => ({ t: k, f: (r) => (r[k] == null ? '-' : r[k]) })), rows) : h('p', { class: 'mut' }, 'Belum ada perubahan.'));
  }

  const TABS = [['upload', 'Upload', viewUpload], ['trx', 'TRX PEI', viewTrx, 1], ['val', 'Validasi MNC', viewVal, 1], ['export', 'Export iFast', viewExport, 1], ['diag', 'Kenapa tidak muncul?', viewDiag, 1], ['audit', 'Audit', viewAudit, 1]];
  function render() {
    const keep = [...document.querySelectorAll('.tw')].map((e) => e.scrollTop);
    $('tabs').replaceChildren(...TABS.map(([id, label, , needs]) => h('button', { class: S.tab === id ? 'on' : '', disabled: needs && !S.ctx, onclick: () => { S.tab = id; render(); } }, label)));
    const t = TABS.find((x) => x[0] === S.tab); $('main').replaceChildren(t[2]());
    document.querySelectorAll('.tw').forEach((e, i) => { if (keep[i]) e.scrollTop = keep[i]; });
  }
  $('logout').addEventListener('click', async () => { await fetch('/api/logout', { method: 'POST' }); location.href = '/login'; });
  fetch('/api/me').then((r) => (r.ok ? r.json() : Promise.reject())).then((m) => { S.user = m.user; S.role = m.role; $('who').textContent = `${m.user} (${m.role})`; render(); }).catch(() => (location.href = '/login'));
  render();
})();

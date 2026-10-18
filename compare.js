// Bandingkan port JS vs keluaran Python asli (python_ref.json). Jalankan: node compare.js
const fs = require('fs'), path = require('path'), XLSX = require('xlsx');
const C = require('../public/core.js');
const D = path.join(__dirname, 'data');
const ref = JSON.parse(fs.readFileSync(D + '/python_ref.json', 'utf8'));
const xrows = (f) => XLSX.utils.sheet_to_json(XLSX.readFile(D + '/' + f).Sheets[XLSX.readFile(D + '/' + f).SheetNames[0]], { defval: undefined });
const txt = (f) => fs.readFileSync(D + '/' + f, 'utf8');
const hb = JSON.parse(fs.readFileSync(D + '/hasil_buy.json', 'utf8'));
const hasil = new Map(); for (const r of hb) { if (!hasil.has(r[0])) hasil.set(r[0], []); hasil.get(r[0]).push(r); }

const ctx = C.buildContext({ closingRows: xrows('closing.xlsx'), riskText: txt('risk.txt'), opText: txt('op.txt'), nettingRows: xrows('netting.xlsx'),
  clText: txt('cl.txt'), sidClientRows: xrows('sidclient.xlsx'), posText: txt('pos.txt'), lrSettleText: txt('lrsettle.txt'), hasilBuyRows: hasil });
const st = C.newState();
const pei = C.runPei(ctx, st), mnc = C.runMnc(ctx, st);

let n = 0, bad = 0; const issues = [];
function eq(label, a, b) {
  n++;
  const ok = (typeof a === 'number' && typeof b === 'number') ? Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b)) : a === b;
  if (!ok) { bad++; if (issues.length < 25) issues.push(`${label}: js=${JSON.stringify(a)} py=${JSON.stringify(b)}`); }
}
const num = (v) => (v == null ? 0 : v);
const dictEq = (label, a, b) => { const ka = Object.keys(a).sort(), kb = Object.keys(b).sort(); eq(label + ' keys', ka.join(), kb.join()); for (const k of ka) if (k in b) eq(label + '.' + k, a[k], b[k]); };

// closing + op + net
eq('closing size', ctx.cp.size, Object.keys(ref.closing).length);
for (const [k, v] of ctx.cp) eq('cp ' + k, v, ref.closing[k]);
eq('op size', ctx.op.size, Object.keys(ref.op).length);
for (const [sid, d] of ctx.op) { const r = ref.op[sid]; eq('op loan ' + sid, d.loan_existing, r.loan_existing); eq('op acc ' + sid, d.accrued_interest, r.accrued_interest); dictEq('op stocks ' + sid, d.stocks, r.stocks); }
for (const [name, mine, theirs] of [['buy', ctx.netBuy, ref.net_buy], ['sell', ctx.netSell, ref.net_sell]]) {
  eq('net' + name + ' sids', [...mine.keys()].sort().join(), Object.keys(theirs).sort().join());
  for (const [sid, m] of mine) for (const s of Object.keys(m)) { eq(`net${name} ${sid} ${s} lot`, m[s].lot, theirs[sid][s].lot); eq(`net${name} ${sid} ${s} val`, m[s].value, theirs[sid][s].value); }
}

// TRX PEI
const peiFields = ['name', 'cid', 'loan_existing', 'accrued', 'avail_limit', 'total_rp_maks', 'total_rp_min', 'total_rp_min_ratio', 'coll_before_rp', 'coll_after_rp', 'coll_after_lr',
  'loan_after_rp', 'total_buy_val', 'avail_efektif', 'max_lr_63', 'max_lr_final', 'lr_binding'];
eq('pei sids', [...pei.keys()].sort().join(), Object.keys(ref.pei).sort().join());
for (const [sid, d] of pei) {
  const r = ref.pei[sid];
  for (const f of peiFields) eq(`pei ${sid} ${f}`, d[f], r[f]);
  eq(`pei ${sid} rasio_rp`, d.rasio_rp, r.rasio_rp); eq(`pei ${sid} rasio_lr`, d.rasio_lr, r.rasio_lr);
  dictEq(`pei ${sid} after_rp`, d.stocks_after_rp, r.stocks_after_rp); dictEq(`pei ${sid} after_lr`, d.stocks_after_lr, r.stocks_after_lr);
  eq(`pei ${sid} rp_detail n`, d.rp_detail.length, r.rp_detail.length);
  d.rp_detail.forEach((x, i) => { for (const k of ['stock', 'lot_sell', 'lot_op', 'lot_keluar', 'price', 'rp_min', 'ada_di_op']) eq(`pei ${sid} rpd${i}.${k}`, x[k], r.rp_detail[i][k]); });
  d.buy_status_detail.forEach((x, i) => { for (const k of ['stock', 'lot_beli', 'available_qty', 'status']) eq(`pei ${sid} bsd${i}.${k}`, x[k], r.buy_status_detail[i][k]); });
}

// Validasi MNC
const mncFields = ['name', 'loan_existing', 'accrued', 'avail_limit', 'total_rp_maks', 'total_rp_min', 'total_rp_min_ratio', 'loan_after_rp', 'coll_before_rp', 'coll_after_rp',
  'coll_after_lr', 'max_lr_63', 'max_lr_final', 'lr_binding', 'avail_efektif', 'total_buy_val'];
eq('mnc sids', [...mnc.keys()].join(), Object.keys(ref.mnc).join());
let nLolosRp = 0, nLolosLr = 0, nFail = 0;
for (const [sid, d] of mnc) {
  const r = ref.mnc[sid];
  for (const f of mncFields) eq(`mnc ${sid} ${f}`, d[f], r[f]);
  eq(`mnc ${sid} has_rp`, d.has_rp, r.has_rp); eq(`mnc ${sid} has_lr`, d.has_lr, r.has_lr); eq(`mnc ${sid} rp_skipped`, d.rp_skipped, r.rp_skipped);
  dictEq(`mnc ${sid} after_rp`, d.stocks_after_rp, r.stocks_after_rp); dictEq(`mnc ${sid} after_lr`, d.stocks_after_lr, r.stocks_after_lr);
  const rc = ref.mnc_checks[sid]; eq(`mnc ${sid} checks n`, d.checks.length, rc.length);
  d.checks.forEach((c, i) => { eq(`mnc ${sid} check ${i} label`, c.label, rc[i][0]); eq(`mnc ${sid} check ${i} passed`, c.passed, rc[i][1]); if (!c.passed) nFail++; });
  eq(`mnc ${sid} lolos_rp`, C.lolosRp(d), ref.lolos_rp[sid]); eq(`mnc ${sid} lolos_lr`, C.lolosLr(d), ref.lolos_lr[sid]);
  if (C.lolosRp(d)) nLolosRp++; if (C.lolosLr(d)) nLolosLr++;
}
const g = C.globalResult(mnc); eq('global rp', g.total_rp, ref.global.rp); eq('global lr', g.total_lr, ref.global.lr);

// File iFast
function cmpSheets(label, mine, theirs) {
  for (const sh of Object.keys(theirs)) {
    const a = mine[sh], b = theirs[sh]; eq(`${label} ${sh} rows`, a.length, b.length);
    a.forEach((row, i) => { for (const k of Object.keys(b[i] || {})) eq(`${label} ${sh}[${i}].${k}`, row[k], b[i][k]); });
  }
}
cmpSheets('ifast RP', C.ifastRepayment(mnc), ref.ifast.rp); cmpSheets('ifast LR', C.ifastLoan(mnc), ref.ifast.lr);

console.log(`Dicek: ${n} nilai, selisih: ${bad}`);
console.log(`(info: ${mnc.size} SID validasi, lolos RP=${nLolosRp}, lolos LR=${nLolosLr}, check gagal=${nFail}; baris iFast RP=${ref.ifast.rp['Repayment Direct'].length}, LR=${ref.ifast.lr['Loan'].length})`);
if (bad) { console.log(issues.join('\n')); process.exit(1); }

/* PEI Core — port dari "Daily RP and LR Calculation.py" (Streamlit).
 * Murni logika (tanpa DOM/File API) supaya bisa dites di Node dan dipakai browser.
 * Semua input sudah berupa teks / array of objects (hasil parse XLSX di lapisan UI). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PEICore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const RATIO_THRESHOLD = 0.65;
  const AUTO_ADJUST_TARGET = 0.63;
  const CREDIT_LIMIT_PARTISIPAN = 160000000000.0;
  const LR1 = 'LR-1. Volume Buy ≤ Available Qty';
  const LR3 = 'LR-3. Nilai Beli ≤ Max LR Final';

  const dict = () => Object.create(null);
  const copyDict = (o) => Object.assign(dict(), o);

  // ── util gaya Python ──
  const FLOAT_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
  function pyFloat(s) { // float() Python; NaN jika gagal
    if (typeof s === 'number') return s;
    const t = String(s == null ? '' : s).trim();
    return FLOAT_RE.test(t) ? Number(t) : NaN;
  }
  const f0 = (s) => { const v = pyFloat(s); return Number.isNaN(v) ? 0 : v; };
  const toNumeric = (s) => pyFloat(String(s == null ? '' : s).replace(/,/g, ''));
  const splitLines = (c) => String(c).trim().split(/\r\n|\r|\n/);
  const str = (v) => (v == null ? '' : String(v)).trim();

  const fmtRp = (v) => 'Rp ' + Math.round(Number(v)).toLocaleString('en-US').replace(/,/g, '.');
  const fmtPct = (v) => (Number(v) * 100).toFixed(2) + '%';

  // ── rename kolom (find_and_rename) ──
  const ALIASES = {
    stock_key: ['no_share', 'no_shares', 'Stock Code', 'Stockcode', 'Stock', 'SYMBOL', 'StockCode'],
    sid_key: ['SID', 'SID_No', 'Client_SID'],
    cid_key: ['no_cust', 'CID', 'Client_ID', 'Account_No'],
    avail_risk: ['Available Quantity', 'availablequantity', 'Available Qty', 'AvailableQuantity'],
    name_key: ['Name', 'Client_Name', 'Nama'],
    haircut_key: ['Haircut', 'haircut', 'HC'],
    margin_flag: ['Margin', 'margin', 'MARGIN', 'flag_margin', 'MarginFlag'],
  };
  function headersOf(rows) {
    const h = []; const seen = new Set();
    for (const r of rows) for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); h.push(k); }
    return h;
  }
  function findAndRename(rows) {
    const headers = headersOf(rows); const map = {};
    for (const [official, aliases] of Object.entries(ALIASES)) {
      for (const c of headers) if (aliases.includes(String(c).trim())) { map[c] = official; break; }
    }
    const out = rows.map((r) => { const n = {}; for (const [k, v] of Object.entries(r)) n[map[k] || k] = v; return n; });
    return { rows: out, headers: headers.map((h) => map[h] || h) };
  }

  // ── perhitungan ──
  function calcCollateral(stocks, cp, hc) {
    let total = 0; const detail = [];
    for (const stock of Object.keys(stocks)) {
      const qty = stocks[stock];
      const price = cp.has(stock) ? cp.get(stock) : 0;
      const h = hc.has(stock) ? hc.get(stock) : 0.05;
      const coll = qty * price * (1 - h);
      total += coll; detail.push({ stock, qty, cp: price, hc: h, collateral: coll });
    }
    return [total, detail];
  }
  function solveRpMin(loanEx, accrued, collAfterRp) {
    const rp = collAfterRp > 0 ? (loanEx + accrued) - collAfterRp * RATIO_THRESHOLD : loanEx + accrued;
    return Math.min(Math.max(rp, 0), loanEx);
  }
  const solveRpMax = (loanEx, accrued) => loanEx + accrued;
  function solveLr(collAfterLr, loanAfterRp, accrued, availLim, totalRp, totalBuyVal) {
    const lr63 = collAfterLr > 0 ? Math.max(collAfterLr * AUTO_ADJUST_TARGET - (loanAfterRp + accrued), 0) : 0;
    const availEf = availLim + totalRp;
    const capBuy = totalBuyVal * 1.1;
    const cands = [['Rasio 63%', lr63], ['Available Limit', availEf], ['Nilai Beli x110%', capBuy]];
    let best = cands[0];
    for (const c of cands) if (c[1] < best[1]) best = c; // min() Python: elemen pertama bila sama
    return [lr63, availEf, best[1], best[0]];
  }
  function getLoanStatus(availQty, volBuy) {
    if (volBuy <= 0) return '';
    if (availQty < 0) return '';
    return availQty > volBuy ? 'LOAN PEI' : 'LOAN PARTIAL';
  }

  // ── parser file ──
  function loadClosingPrice(rows) {
    const out = new Map();
    for (const r of rows) {
      const code = str(r['no_share']).toUpperCase();
      const price = toNumeric(r['kurs_now']);
      if (!Number.isNaN(price) && code && code !== 'NAN') out.set(code, price);
    }
    return out;
  }
  function loadRiskParameter(content) {
    const hc = new Map(), avq = new Map();
    for (let line of splitLines(content)) {
      line = line.trim();
      if (!line || line.startsWith('StockCode')) continue;
      const p = line.split('|');
      if (p.length < 4) continue;
      const code = p[0].trim().toUpperCase();
      const h = pyFloat(p[2]); const a = pyFloat(p[3]);
      hc.set(code, Number.isNaN(h) ? 0 : h / 100); avq.set(code, Number.isNaN(a) ? 0 : a);
    }
    return { hc, avq };
  }
  function parseOpFile(content) {
    const result = new Map();
    for (let line of splitLines(content)) {
      line = line.trim(); if (!line) continue;
      const p = line.split('|');
      if (p[0] === '0') {
        if (p.length < 7) continue;
        const sid = p[3].trim();
        result.set(sid, {
          loan_existing: f0(p[5]), accrued_interest: f0(p[6]),
          available_limit: p.length > 7 ? f0(p[7]) : 0,
          name: p.length > 4 ? p[4].trim() : sid, stocks: dict(),
        });
      } else if (p[0] === '1') {
        if (p.length < 5) continue;
        const sid = p[2].trim(); const stock = p[3].trim().toUpperCase(); const vol = f0(p[4]);
        if (result.has(sid) && stock && vol > 0) {
          const s = result.get(sid).stocks; s[stock] = (s[stock] || 0) + vol;
        }
      }
    }
    return result;
  }
  function parseCreditLimitFile(content) {
    const result = new Map(); let valueDate = null;
    splitLines(content).forEach((raw, i) => {
      const line = raw.trim(); if (!line) return;
      const p = line.split('|');
      if (i === 0 && p[0].trim().toLowerCase() === 'value date') return;
      if (p.length < 7) return;
      const sid = p[2].trim();
      const v = pyFloat(p[6].replace(/,/g, ''));
      if (valueDate === null) valueDate = p[0].trim();
      result.set(sid, { available_limit: Number.isNaN(v) ? 0 : v, name: p[3].trim(), value_date: p[0].trim() });
    });
    return { data: result, valueDate };
  }
  function loadParticipantStockPosition(content) {
    const result = new Map();
    splitLines(content).forEach((raw, i) => {
      const line = raw.trim(); if (!line) return;
      if (i === 0 && line.toLowerCase().startsWith('date')) return;
      const p = line.split('|'); if (p.length < 9) return;
      const sid = p[2].trim(); const stock = p[4].trim().toUpperCase();
      const receive = f0(p[7]), deliver = f0(p[8]); const delta = receive - deliver;
      if (delta === 0) return;
      if (!result.has(sid)) result.set(sid, dict());
      result.get(sid)[stock] = { receive, deliver, delta };
    });
    return result;
  }
  function loadLrBelumSettle(content) {
    const result = new Map();
    for (let line of splitLines(content)) {
      line = line.trim(); if (!line) continue;
      const p = line.split('|');
      if (p[0] !== '0' || p.length < 8) continue;
      const sid = p[2].trim();
      result.set(sid, (result.get(sid) || 0) + f0(p[p.length - 1]));
    }
    return result;
  }
  function cloneOp(op) {
    const out = new Map();
    for (const [sid, d] of op) out.set(sid, Object.assign({}, d, { stocks: copyDict(d.stocks) }));
    return out;
  }
  function applyLrAdjustmentToOp(op, lr) {
    const out = cloneOp(op);
    for (const [sid, v] of lr) if (out.has(sid)) out.get(sid).loan_existing += v;
    return out;
  }
  function applyPositionAdjustmentToOp(op, pos) {
    const out = cloneOp(op);
    for (const [sid, adj] of pos) {
      if (!out.has(sid)) continue;
      const stocks = out.get(sid).stocks;
      for (const stock of Object.keys(adj)) {
        const nq = (stocks[stock] || 0) + adj[stock].delta;
        if (nq <= 0) delete stocks[stock]; else stocks[stock] = nq;
      }
    }
    return out;
  }

  // Netting Invoice. rows = array of objects (header → nilai). Kembalikan juga jejak untuk diagnostik.
  function parseNettingInvoice(rowsIn) {
    const { rows, headers } = findAndRename(rowsIn);
    for (const req of ['stock_key', 'sid_key', 'cid_key', 'bors', 'tot_vol'])
      if (!headers.includes(req)) throw new Error(`Kolom '${req}' tidak ditemukan di file Netting Invoice.`);
    const hasBoard = headers.includes('board'), hasLorf = headers.includes('lorf');
    const valCol = headers.includes('amt_done') ? 'amt_done' : (headers.includes('amt_pay') ? 'amt_pay' : null);
    if (!valCol) throw new Error('Kolom nilai transaksi (amt_done/amt_pay) tidak ditemukan di file Netting Invoice.');
    const hasName = headers.includes('name');

    const netting = new Map(), cidToSid = new Map(), sidToName = new Map();
    const trace = { rawRows: new Map(), droppedBoard: new Map(), droppedLorf: new Map(), rawSids: new Set() };
    const inc = (m, k) => m.set(k, (m.get(k) || 0) + 1);
    for (const r of rows) {
      const sid = str(r.sid_key), cid = str(r.cid_key), stock = str(r.stock_key).toUpperCase();
      const side = str(r.bors).toUpperCase();
      if (sid) { trace.rawSids.add(sid); inc(trace.rawRows, sid); }
      if (hasBoard && str(r.board).toUpperCase() !== 'RG') { if (sid) inc(trace.droppedBoard, sid); continue; }
      if (hasLorf && str(r.lorf).toUpperCase() !== 'D') { if (sid) inc(trace.droppedLorf, sid); continue; }
      if (!sid || !stock) continue;
      const vol = f0(String(r.tot_vol == null ? '' : r.tot_vol).replace(/,/g, ''));
      const val = f0(String(r[valCol] == null ? '' : r[valCol]).replace(/,/g, ''));
      if (cid) cidToSid.set(cid, sid);
      if (hasName && !sidToName.has(sid)) { const nm = str(r.name); if (nm && nm.toLowerCase() !== 'nan') sidToName.set(sid, nm); }
      if (!netting.has(sid)) netting.set(sid, dict());
      const m = netting.get(sid);
      const d = m[stock] || (m[stock] = { buy_lot: 0, sell_lot: 0, buy_value: 0, sell_value: 0 });
      if (side === 'B') { d.buy_lot += vol; d.buy_value += val; }
      else if (side === 'S') { d.sell_lot += vol; d.sell_value += val; }
    }
    for (const m of netting.values()) for (const d of Object.values(m)) {
      d.net_lot = d.buy_lot - d.sell_lot; d.net_value = d.buy_value - d.sell_value;
    }
    return { netting, cidToSid, sidToName, trace };
  }
  function splitNetting(netting, cp) {
    const netBuy = new Map(), netSell = new Map();
    for (const [sid, stocks] of netting) {
      for (const stock of Object.keys(stocks)) {
        const d = stocks[stock]; const netLot = d.buy_lot - d.sell_lot;
        const price = cp.has(stock) ? cp.get(stock) : 0;
        if (netLot > 0) { if (!netBuy.has(sid)) netBuy.set(sid, dict()); netBuy.get(sid)[stock] = { lot: netLot, value: d.buy_lot * price }; }
        else if (netLot < 0) { if (!netSell.has(sid)) netSell.set(sid, dict()); netSell.get(sid)[stock] = { lot: -netLot, value: d.sell_lot * price }; }
      }
    }
    return { netBuy, netSell };
  }

  // SID Client (xlsx rows) → peta PEI
  function parseSidClient(rowsIn) {
    const { rows, headers } = findAndRename(rowsIn);
    for (const req of ['sid_key', 'cid_key'])
      if (!headers.includes(req)) throw new Error(`Kolom '${req}' tidak ditemukan di file SID Client.`);
    const sidToCid = new Map(), cidToName = new Map(), pei = new Set();
    const hasName = headers.includes('name_key');
    for (const r of rows) {
      const sid = str(r.sid_key), cid = str(r.cid_key);
      sidToCid.set(sid, cid); pei.add(sid);
      if (hasName && !cidToName.has(cid)) cidToName.set(cid, str(r.name_key));
    }
    return { sidToCid, cidToName, peiSids: pei };
  }

  /** Bangun konteks dari input mentah.
   * inputs: {closingRows, riskText, opText, nettingRows, clText, sidClientRows, posText?, lrSettleText?, hasilBuyRows?} */
  function buildContext(inputs) {
    const cp = loadClosingPrice(inputs.closingRows);
    const risk = loadRiskParameter(inputs.riskText);
    const opRaw = parseOpFile(inputs.opText);
    let op = opRaw; let pos = new Map(), lrs = new Map();
    if (inputs.posText) { pos = loadParticipantStockPosition(inputs.posText); op = applyPositionAdjustmentToOp(op, pos); }
    if (inputs.lrSettleText) { lrs = loadLrBelumSettle(inputs.lrSettleText); op = applyLrAdjustmentToOp(op, lrs); }
    const net = parseNettingInvoice(inputs.nettingRows);
    const { netBuy, netSell } = splitNetting(net.netting, cp);
    const cl = parseCreditLimitFile(inputs.clText);
    const sc = parseSidClient(inputs.sidClientRows);
    return {
      cp, hc: risk.hc, avq: risk.avq, opRaw, op, pos, lrs, netting: net.netting, trace: net.trace,
      cidToSidInvoice: net.cidToSid, sidToNameInvoice: net.sidToName, netBuy, netSell,
      cl: cl.data, clValueDate: cl.valueDate,
      sidToCid: sc.sidToCid, cidToName: sc.cidToName, peiSids: sc.peiSids,
      hasilBuyRows: inputs.hasilBuyRows || null, // Map sid → array of arrays (Hasil MNC sheet LR), opsional
    };
  }

  /** Hitung satu SID.
   * opts.mode: 'pei' (tab TRX PEI Python) | 'mnc' (tab Validasi Python)
   * opts.rpOverride / opts.lrOverride: nilai RP Final / LR Final hasil edit (sumber kebenaran tunggal)
   * opts.adjusted: Auto-Adjust LR sudah diterapkan untuk SID ini */
  function computeSid(sid, ctx, opts) {
    opts = opts || {}; const mode = opts.mode || 'mnc';
    const op = ctx.op.get(sid) || { loan_existing: 0, accrued_interest: 0, name: null, stocks: dict() };
    const cl = ctx.cl.get(sid) || { available_limit: 0, name: null };
    const loanEx = op.loan_existing, accrued = op.accrued_interest, availLim = cl.available_limit;
    const cid = ctx.sidToCid.get(sid) || '';
    const name = op.name || ctx.cidToName.get(cid) || cl.name || sid;
    const stocksOp = op.stocks;
    const sellStocks = ctx.netSell.get(sid) || dict();
    const buyStocks = ctx.netBuy.get(sid) || dict();
    const checks = []; const add = (label, passed, detail) => checks.push({ label, passed, detail: detail || '' });

    const rpDetail = []; const stocksAfterRp = copyDict(stocksOp); let totalRpMin = 0;
    const hasRp = Object.keys(sellStocks).length > 0;
    const rpActive = hasRp && loanEx > 0;
    const subtract = (stock, lot) => { stocksAfterRp[stock] = (stocksAfterRp[stock] || 0) - lot; if (stocksAfterRp[stock] <= 0) delete stocksAfterRp[stock]; };

    if (mode === 'pei') {
      for (const stock of Object.keys(sellStocks)) {
        const lotSell = sellStocks[stock].lot, lotOp = stocksOp[stock] || 0;
        const lotKeluar = Math.min(lotSell, lotOp); const price = ctx.cp.has(stock) ? ctx.cp.get(stock) : 0;
        rpDetail.push({ stock, lot_sell: lotSell, lot_op: lotOp, lot_keluar: lotKeluar, price, rp_min: lotKeluar * price, ada_di_op: lotOp > 0 });
      }
      for (const d of rpDetail) { if (d.ada_di_op) totalRpMin += d.rp_min; }
      for (const d of rpDetail) if (d.ada_di_op && d.lot_keluar > 0) subtract(d.stock, d.lot_keluar);
    } else if (rpActive) {
      for (const stock of Object.keys(sellStocks)) {
        const lotSell = sellStocks[stock].lot, lotOp = stocksOp[stock] || 0;
        const lotKeluar = Math.min(lotSell, lotOp); const price = ctx.cp.has(stock) ? ctx.cp.get(stock) : 0;
        if (lotOp > 0) {
          totalRpMin += lotKeluar * price;
          rpDetail.push({ stock, lot_sell: lotSell, lot_op: lotOp, lot_keluar: lotKeluar, price, rp_min: lotKeluar * price, ada_di_op: true });
          subtract(stock, lotKeluar);
        }
      }
    }

    const [collAfterRp] = calcCollateral(stocksAfterRp, ctx.cp, ctx.hc);
    const totalRpMinRatio = (mode === 'pei' || rpActive) ? solveRpMin(loanEx, accrued, collAfterRp) : 0;
    const totalRpMaks = rpActive ? solveRpMax(loanEx, accrued) : 0;
    const rpFinal = (opts.rpOverride != null) ? opts.rpOverride : totalRpMaks;
    const loanAfterRp = Math.max(loanEx - rpFinal, 0);
    const numRp = loanAfterRp + accrued;
    const rasioRp = collAfterRp > 0 ? numRp / collAfterRp : null;

    // checks RP
    if (!rpActive) {
      const msg = loanEx <= 0 ? '⏭ Dilewati — Loan Existing = 0' : 'Tidak ada transaksi jual';
      add('RP-1. Pengecekan Saham Jual', true, msg); add('RP-2. Lot Sell ≤ Lot di OP', true, msg); add('RP-3. Rasio After RP < 65%', true, msg);
    } else {
      const rp1 = Object.keys(sellStocks).filter((s) => (stocksOp[s] || 0) === 0);
      add('RP-1. Pengecekan Saham Jual', true, rp1.length ? `ℹ️ Saham reguler (bukan OP): ${rp1.join(', ')}` : '✅ Semua saham jual ada di OP');
      const rp2 = rpDetail.filter((d) => d.lot_sell > d.lot_op && d.ada_di_op).map((d) => `${d.stock}: ${d.lot_sell} → ${d.lot_op}`);
      add('RP-2. Lot Sell ≤ Lot di OP', true, rp2.length ? '⚠️ Auto-adjusted: ' + rp2.join('; ')
        : `Total RP Max (rekomendasi): ${fmtRp(totalRpMaks)} | RP Min (ref): ${fmtRp(totalRpMinRatio)}`);
      if (rasioRp !== null) add('RP-3. Rasio After RP < 65%', rasioRp < RATIO_THRESHOLD, `Rasio: ${fmtPct(rasioRp)} | Numerator: ${fmtRp(numRp)} | Coll: ${fmtRp(collAfterRp)}`);
      else if (numRp <= 0) add('RP-3. Rasio After RP < 65%', true, 'Numerator ≤ 0');
      else add('RP-3. Rasio After RP < 65%', false, 'Collateral = 0');
    }

    // LR
    const hasLr = Object.keys(buyStocks).length > 0;
    const stocksAfterLr = copyDict(stocksAfterRp); const buyStatus = [];
    for (const stock of Object.keys(buyStocks)) {
      stocksAfterLr[stock] = (stocksAfterLr[stock] || 0) + buyStocks[stock].lot;
      const a = ctx.avq.has(stock) ? ctx.avq.get(stock) : 0;
      buyStatus.push({ stock, lot_beli: buyStocks[stock].lot, available_qty: a, status: getLoanStatus(a, buyStocks[stock].lot) });
    }
    const [collAfterLr] = calcCollateral(stocksAfterLr, ctx.cp, ctx.hc);
    let totalBuyVal = 0; for (const s of Object.keys(buyStocks)) totalBuyVal += buyStocks[s].value;
    const [maxLr63, availEf, maxLrFinal, binding] = solveLr(collAfterLr, loanAfterRp, accrued, availLim, rpFinal, totalBuyVal);
    const lrFinal = (opts.lrOverride != null) ? opts.lrOverride : maxLrFinal;
    const rasioLr = collAfterLr > 0 ? (loanAfterRp + accrued + Math.min(totalBuyVal, lrFinal)) / collAfterLr : null;

    if (!hasLr) {
      add(LR1, true, 'Tidak ada Loan Request');
      add('LR-2. Kapasitas LR (63% / Avail Limit / Nilai Beli x110%)', true, 'Tidak ada Loan Request');
      add(LR3, true, 'Tidak ada Loan Request');
    } else {
      let pass1 = true; const det1 = [];
      if (ctx.hasilBuyRows) { // sumber asli: sheet LR di Hasil MNC (kolom 1=saham, 4=avail, 13=vol)
        for (const row of (ctx.hasilBuyRows.get(sid) || [])) {
          const vol = f0(row[13]), avq = f0(row[4]), stk = String(row[1] == null ? '' : row[1]);
          if (avq === 0) { pass1 = false; det1.push(`${stk}: DIBATALKAN (Available=0)`); }
          else if (vol > avq) { pass1 = false; det1.push(`${stk}: Vol ${vol} > Avail ${avq}`); }
        }
      } else { // tanpa Hasil MNC: pakai Available Qty dari Risk Parameter
        for (const b of buyStatus) {
          if (b.available_qty === 0) { pass1 = false; det1.push(`${b.stock}: DIBATALKAN (Available=0)`); }
          else if (b.lot_beli > b.available_qty) { pass1 = false; det1.push(`${b.stock}: Vol ${b.lot_beli} > Avail ${b.available_qty}`); }
        }
      }
      add(LR1, pass1, det1.length ? det1.join('; ') : `Total Nilai Beli: ${fmtRp(totalBuyVal)}`);
      add('LR-2. Kapasitas LR (63% / Avail Limit / Nilai Beli x110%)', true,
        `LR @63%: ${fmtRp(maxLr63)} | Avail Efektif: ${fmtRp(availEf)} | Nilai Beli x110%: ${fmtRp(totalBuyVal * 1.1)} | Max LR Final: ${fmtRp(lrFinal)} (binding: ${binding})`);
      let pass3 = totalBuyVal <= lrFinal;
      let det3 = `Nilai Beli: ${fmtRp(totalBuyVal)} vs Max LR Final: ${fmtRp(lrFinal)} | Rasio jika full: ${rasioLr !== null ? fmtPct(rasioLr) : 'N/A'}`;
      if (!pass3) {
        if (opts.adjusted) { pass3 = true; det3 = `✂️ Di-adjust ke ${fmtRp(lrFinal)} | Rasio: ${rasioLr !== null ? fmtPct(rasioLr) : 'N/A'}`; }
        else det3 += ` || ⚠️ Potong Loan Request ke: ${fmtRp(lrFinal)}`;
      }
      add(LR3, pass3, det3);
    }

    return {
      sid, name, cid: ctx.sidToCid.get(sid) || sid, checks, has_rp: hasRp, has_lr: hasLr, rp_skipped: loanEx <= 0,
      loan_existing: loanEx, accrued, avail_limit: availLim,
      stocks_op: stocksOp, stocks_after_rp: stocksAfterRp, stocks_after_lr: stocksAfterLr, buy_stocks: buyStocks,
      rp_detail: rpDetail, total_rp_maks: totalRpMaks, total_rp_min: totalRpMin, total_rp_min_ratio: totalRpMinRatio,
      rp_final: rpFinal, rp_edited: opts.rpOverride != null,
      loan_after_rp: loanAfterRp, rasio_rp: rasioRp,
      coll_before_rp: calcCollateral(stocksOp, ctx.cp, ctx.hc)[0], coll_after_rp: collAfterRp, coll_after_lr: collAfterLr,
      max_lr_63: maxLr63, avail_efektif: availEf, max_lr_final: maxLrFinal, lr_binding: binding,
      lr_final: lrFinal, lr_edited: opts.lrOverride != null, total_buy_val: totalBuyVal, rasio_lr: rasioLr,
      buy_status_detail: buyStatus, adjusted: !!opts.adjusted,
    };
  }

  const lolosRp = (d) => !d.rp_skipped && d.has_rp && d.checks.filter((c) => c.label.startsWith('RP-')).every((c) => c.passed);
  const lolosLr = (d) => d.has_lr && d.checks.filter((c) => c.label.startsWith('LR-')).every((c) => c.passed);

  // ── state = SATU sumber kebenaran ──
  function newState() { return { rp: new Map(), lr: new Map(), adjusted: new Set(), audit: [] }; }
  function setOverride(state, kind, sid, value, user, note) {
    const prev = state[kind].get(sid);
    if (value == null || Number.isNaN(value)) state[kind].delete(sid); else state[kind].set(sid, value);
    state.audit.push({ ts: new Date().toISOString(), user: user || '-', kind: kind.toUpperCase(), sid, from: prev == null ? null : prev, to: value == null ? null : value, note: note || '' });
  }
  function optsFor(state, sid, mode) {
    return { mode, rpOverride: state.rp.has(sid) ? state.rp.get(sid) : null, lrOverride: state.lr.has(sid) ? state.lr.get(sid) : null, adjusted: state.adjusted.has(sid) };
  }
  function runPei(ctx, state) {
    const out = new Map();
    for (const sid of ctx.peiSids) out.set(sid, computeSid(sid, ctx, optsFor(state, sid, 'pei')));
    return out;
  }
  function runMnc(ctx, state) {
    const all = new Set([...ctx.op.keys(), ...ctx.cl.keys(), ...ctx.netBuy.keys(), ...ctx.netSell.keys()]);
    const out = new Map();
    for (const sid of [...all].sort()) {
      const r = computeSid(sid, ctx, optsFor(state, sid, 'mnc')); r.is_pei = ctx.peiSids.has(sid); out.set(sid, r);
    }
    return out;
  }
  function globalResult(results) {
    let rp = 0, lr = 0;
    for (const d of results.values()) { if (lolosLr(d)) lr += d.lr_final; if (lolosRp(d)) rp += d.rp_final; }
    return { passed: CREDIT_LIMIT_PARTISIPAN + rp > lr, total_rp: rp, total_lr: lr,
      detail: `CL Partisipan: ${fmtRp(CREDIT_LIMIT_PARTISIPAN)} + RP: ${fmtRp(rp)} = ${fmtRp(CREDIT_LIMIT_PARTISIPAN + rp)} | LR: ${fmtRp(lr)}` };
  }
  function applyAutoAdjust(state, results, user) {
    const touched = [];
    for (const [sid, d] of results) {
      if (d.has_lr && d.is_pei && d.checks.some((c) => c.label === LR3 && !c.passed)) { state.adjusted.add(sid); touched.push(sid);
        state.audit.push({ ts: new Date().toISOString(), user: user || '-', kind: 'AUTO-ADJUST', sid, from: null, to: d.lr_final, note: 'LR-3 di-adjust ke Max LR Final' }); }
    }
    return touched;
  }

  // ── export: SEMUA membaca rp_final / lr_final (nilai hasil edit) ──
  function ifastRepayment(results) {
    const loan = [], stock = [];
    for (const [sid, d] of results) {
      if (!lolosRp(d)) continue; if (d.rp_final <= 0) continue;
      loan.push({ 'Participant Code': 'EP', 'SID Client': sid, 'Repayment Value': d.rp_final });
      for (const rd of d.rp_detail) if (rd.lot_keluar > 0) stock.push({ 'SID Client': sid, 'Stock Code': rd.stock, 'Quantity': Math.trunc(rd.lot_keluar) });
    }
    return { 'Repayment Direct': loan, 'Stock': stock };
  }
  function ifastLoan(results) {
    const loan = [], stock = [];
    for (const [sid, d] of results) {
      if (!lolosLr(d)) continue; if (d.lr_final <= 0) continue;
      loan.push({ 'Participant Code': 'EP', 'SID Client': sid, 'Loan Value': d.lr_final });
      for (const s of Object.keys(d.stocks_after_lr)) {
        const lotBeli = d.stocks_after_lr[s] - (d.stocks_after_rp[s] || 0);
        if (lotBeli > 0) stock.push({ 'SID Client': sid, 'Stock Code': s, 'Quantity': Math.trunc(lotBeli) });
      }
    }
    return { 'Loan': loan, 'Stock': stock };
  }
  const pct = (v) => (v !== null && v !== undefined ? fmtPct(v) : 'N/A');
  function hasilTrxPei(res) { // pei-mode results → 3 sheet seperti Hasil_TRX_PEI.xlsx
    const rp = [], lr = [], sum = [];
    for (const [sid, d] of res) {
      for (const rd of d.rp_detail) { if (!rd.ada_di_op) continue;
        rp.push({ SID: sid, Nama: d.name, Saham: rd.stock, 'Lot Jual': Math.trunc(rd.lot_sell), 'Lot OP': Math.trunc(rd.lot_op), 'Lot Keluar': Math.trunc(rd.lot_keluar), Harga: rd.price,
          'Nilai Jual (ref)': rd.rp_min, 'RP Min (ref)': d.total_rp_min_ratio, 'RP Final': d.rp_final, 'RP Max (rekomendasi)': d.total_rp_maks,
          'Loan After RP': d.loan_after_rp, 'Rasio After RP': pct(d.rasio_rp) }); }
      if (d.lr_final > 0) lr.push({ SID: sid, Nama: d.name, 'RP Final': d.rp_final, 'Avail Limit': d.avail_limit, 'Avail Efektif': d.avail_efektif, 'LR @63%': d.max_lr_63,
        'Loan After RP': d.loan_after_rp, 'Coll After LR': d.coll_after_lr, 'Rasio LR': pct(d.rasio_lr), 'Max LR Final': d.max_lr_final, 'LR Final': d.lr_final, Binding: d.lr_binding });
      sum.push({ SID: sid, Nama: d.name, 'Loan Existing': d.loan_existing, 'Coll Awal': d.coll_before_rp,
        'RP Max (rekomendasi)': d.total_rp_maks, 'RP Final': d.rp_final, 'Loan After RP': d.loan_after_rp, 'Rasio RP': pct(d.rasio_rp),
        'Avail Efektif': d.avail_efektif, 'Max LR Final': d.max_lr_final, 'LR Final': d.lr_final, Binding: d.lr_binding, 'Rasio LR': pct(d.rasio_lr) });
    }
    return { 'Repayment (RP)': rp, 'Loan Request (LR)': lr, Summary: sum };
  }
  function toCsv(rows, columns) {
    const cols = columns || (rows.length ? Object.keys(rows[0]) : []);
    const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return [cols.map(esc).join(',')].concat(rows.map((r) => cols.map((c) => esc(r[c])).join(','))).join('\r\n');
  }

  // ── Diagnostik "Kenapa tidak muncul?" per SID/CID/nama ──
  const normId = (x) => String(x || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^0+/, '');
  function resolveSid(query, ctx) {
    const q = str(query); if (!q) return { sid: null, how: 'kosong', variants: [] };
    const pool = new Set([...ctx.peiSids, ...ctx.op.keys(), ...ctx.cl.keys(), ...ctx.trace.rawSids, ...ctx.netting.keys()]);
    if (pool.has(q)) return { sid: q, how: 'SID persis', variants: [] };
    for (const [sid, cid] of ctx.sidToCid) if (cid === q) return { sid, how: 'dicari lewat CID', variants: [] };
    const n = normId(q); const variants = [...pool].filter((x) => normId(x) === n);
    if (variants.length) return { sid: variants[0], how: 'SID cocok setelah dinormalisasi (format beda antar file)', variants };
    const names = []; const ql = q.toLowerCase();
    for (const [sid, d] of ctx.op) if (String(d.name).toLowerCase().includes(ql)) names.push(sid);
    for (const [sid, d] of ctx.cl) if (String(d.name).toLowerCase().includes(ql) && !names.includes(sid)) names.push(sid);
    for (const [cid, nm] of ctx.cidToName) if (String(nm).toLowerCase().includes(ql)) { for (const [sid, c] of ctx.sidToCid) if (c === cid && !names.includes(sid)) names.push(sid); }
    if (names.length) return { sid: names[0], how: `dicari lewat nama (${names.length} kecocokan)`, variants: names };
    return { sid: null, how: 'tidak ditemukan di file mana pun', variants: [] };
  }
  /** Telusuri tahap per tahap. mnc = hasil runMnc (opsional). */
  function diagnoseSid(query, ctx, mnc) {
    const r = resolveSid(query, ctx); const st = []; const push = (stage, status, msg) => st.push({ stage, status, msg });
    if (!r.sid) { push('Pencarian', 'drop', `"${query}" ${r.how}. Cek penulisan SID/CID/nama.`); return { sid: null, resolved: r, stages: st, verdict: 'Tidak ditemukan' }; }
    const sid = r.sid; push('Pencarian', r.variants.length > 1 ? 'warn' : 'ok', `${sid} — ${r.how}${r.variants.length > 1 ? ': ' + r.variants.join(', ') : ''}`);
    const inFile = { 'SID Client': ctx.peiSids.has(sid), 'OP': ctx.op.has(sid), 'Credit Limit': ctx.cl.has(sid), 'Netting Invoice (mentah)': ctx.trace.rawSids.has(sid) };
    const other = [...new Set([...ctx.peiSids, ...ctx.op.keys(), ...ctx.cl.keys(), ...ctx.trace.rawSids])].filter((x) => x !== sid && normId(x) === normId(sid));
    if (other.length) push('Format SID', 'warn', `Ada SID mirip dengan format berbeda di file: ${other.join(', ')} → file tidak akan saling cocok.`);

    if (!inFile['SID Client']) push('SID Client', 'drop', 'SID tidak ada di file SID Client → bukan nasabah PEI, tidak diproses di TRX PEI.'); else push('SID Client', 'ok', 'Terdaftar sebagai nasabah PEI.');

    const raw = ctx.trace.rawRows.get(sid) || 0, db = ctx.trace.droppedBoard.get(sid) || 0, dl = ctx.trace.droppedLorf.get(sid) || 0;
    if (!raw) push('Netting Invoice', 'drop', 'Tidak ada baris transaksi untuk SID ini di Netting Invoice.');
    else {
      push('Netting Invoice', (db || dl) ? 'warn' : 'ok', `${raw} baris mentah; dibuang karena board≠RG: ${db}; karena lorf≠D: ${dl}; terpakai: ${raw - db - dl}.`);
      const net = ctx.netting.get(sid) || dict();
      for (const stock of Object.keys(net)) {
        const d = net[stock]; const nl = d.buy_lot - d.sell_lot;
        const out = nl > 0 ? `NET BELI ${nl} → masuk LR` : (nl < 0 ? `NET JUAL ${-nl} → masuk RP` : 'NETTING NOL (beli = jual) → DIABAIKAN, tidak ada RP/LR');
        push('Netting ' + stock, nl === 0 ? 'drop' : 'ok', `beli ${d.buy_lot} / jual ${d.sell_lot} → ${out}`);
      }
      if (!Object.keys(net).length) push('Netting Invoice', 'drop', 'Semua baris SID ini terbuang oleh filter board/lorf.');
    }
    const stocksUsed = new Set([...Object.keys(ctx.netBuy.get(sid) || {}), ...Object.keys(ctx.netSell.get(sid) || {})]);
    for (const s of stocksUsed) {
      if (!ctx.cp.has(s)) push('Closing Price ' + s, 'drop', 'Harga penutupan tidak ada di file Closing Price → nilai beli/jual = 0 (LR jadi 0 / RP referensi 0).');
      if (!ctx.hc.has(s)) push('Risk Parameter ' + s, 'warn', 'Saham tidak ada di Risk Parameter → haircut default 5% dipakai.');
    }
    const op = ctx.op.get(sid);
    if (!op) push('OP', 'warn', 'SID tidak ada di Outstanding Position → Loan Existing 0, tidak ada RP.');
    else push('OP', op.loan_existing > 0 ? 'ok' : 'warn', `Loan Existing ${fmtRp(op.loan_existing)}, accrued ${fmtRp(op.accrued_interest)}${op.loan_existing > 0 ? '' : ' → RP TIDAK muncul (hanya muncul jika Loan Existing > 0)'}.`);
    const cl = ctx.cl.get(sid);
    push('Credit Limit', cl ? (cl.available_limit > 0 ? 'ok' : 'warn') : 'warn', cl ? `Available Limit ${fmtRp(cl.available_limit)}${cl.available_limit > 0 ? '' : ' → kapasitas LR 0 kecuali ada RP'}.` : 'SID tidak ada di Credit Limit → Available Limit 0.');

    const d = mnc && mnc.get(sid);
    let verdict = 'OK';
    if (d) {
      if (d.has_rp) {
        if (d.rp_skipped) push('RP', 'drop', 'Ada jual bersih tapi Loan Existing = 0 → tidak ada RP.');
        else { const ok = lolosRp(d); push('RP', ok ? 'ok' : 'drop', `RP Final ${fmtRp(d.rp_final)}${d.rp_edited ? ' (diedit)' : ''}. ${ok ? 'Masuk file iFast RP.' : 'GAGAL check: ' + d.checks.filter((c) => c.label.startsWith('RP-') && !c.passed).map((c) => c.label + ' — ' + c.detail).join('; ')}`); if (!ok) verdict = 'RP gugur di validasi'; }
      } else push('RP', 'warn', 'Tidak ada jual bersih → tidak ada RP.');
      if (d.has_lr) {
        const ok = lolosLr(d); const failing = d.checks.filter((c) => c.label.startsWith('LR-') && !c.passed);
        if (d.lr_final <= 0) { push('LR', 'drop', `LR Final = 0 (binding: ${d.lr_binding}; LR@63% ${fmtRp(d.max_lr_63)}, Avail Efektif ${fmtRp(d.avail_efektif)}, Nilai Beli ×110% ${fmtRp(d.total_buy_val * 1.1)}) → tidak masuk file iFast.`); verdict = 'LR = 0'; }
        else if (!ok) { push('LR', 'drop', `LR Final ${fmtRp(d.lr_final)} tapi GAGAL check → tidak masuk file iFast: ${failing.map((c) => c.label + ' — ' + c.detail).join('; ')}${failing.some((c) => c.label === LR3) ? ' (gunakan Auto-Adjust LR untuk memotong ke Max LR Final)' : ''}`); verdict = 'LR gugur di validasi'; }
        else push('LR', 'ok', `LR Final ${fmtRp(d.lr_final)}${d.lr_edited ? ' (diedit)' : ''}, binding ${d.lr_binding}. Masuk file iFast LR.`);
      } else push('LR', 'warn', 'Tidak ada beli bersih → tidak ada LR.');
      if (!d.has_rp && !d.has_lr) verdict = 'Tidak ada transaksi bersih (RP/LR)';
    } else push('Hasil', 'warn', 'Validasi belum dijalankan.');
    if (!inFile['SID Client'] && verdict === 'OK') verdict = 'Bukan nasabah PEI di SID Client';
    return { sid, resolved: r, stages: st, verdict };
  }

  return {
    RATIO_THRESHOLD, AUTO_ADJUST_TARGET, CREDIT_LIMIT_PARTISIPAN, LR3,
    pyFloat, findAndRename, calcCollateral, solveRpMin, solveRpMax, solveLr, getLoanStatus, fmtRp, fmtPct,
    loadClosingPrice, loadRiskParameter, parseOpFile, parseCreditLimitFile, loadParticipantStockPosition, loadLrBelumSettle,
    applyLrAdjustmentToOp, applyPositionAdjustmentToOp, parseNettingInvoice, splitNetting, parseSidClient, buildContext,
    computeSid, lolosRp, lolosLr, newState, setOverride, optsFor, runPei, runMnc, globalResult, applyAutoAdjust,
    ifastRepayment, ifastLoan, hasilTrxPei, toCsv, resolveSid, diagnoseSid,
  };
});

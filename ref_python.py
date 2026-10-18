"""Menjalankan kode ASLI repo (dipotong dari file Streamlit, tanpa diubah) sebagai referensi."""
import sys, types, json, textwrap, io, copy, os, re
import pandas as pd
SRC = '/home/claude/repo/pages/Daily RP and LR Calculation.py'
D = os.path.join(os.path.dirname(__file__), 'data')
lines = open(SRC, encoding='utf-8').read().split('\n')
def idx(prefix, start=0):
    for i in range(start, len(lines)):
        if lines[i].startswith(prefix): return i
    raise KeyError(prefix)

# stub streamlit
st = types.SimpleNamespace(session_state={})
sys.modules['streamlit'] = st
ns = {'pd': pd, 'io': io, 'copy': copy, 'st': st}
from datetime import datetime; ns['datetime'] = datetime
# 1) konstanta + fungsi murni: dari RATIO_THRESHOLD sampai sebelum blok UI upload
a = idx('RATIO_THRESHOLD'); b = idx('# UPLOAD FILE SHARED') - 1
exec('\n'.join(lines[a:b]), ns)

class F:  # file-like seperti UploadedFile
    def __init__(s, p): s.name = os.path.basename(p); s._f = open(p, 'rb')
    def read(s): return s._f.read()
    def seek(s, n): s._f.seek(n)

closing = ns['load_closing_price'](f'{D}/closing.xlsx')
hc, avq = ns['load_risk_parameter'](F(f'{D}/risk.txt'))
op_raw = ns['parse_op_file'](open(f'{D}/op.txt').read())
pos = ns['load_participant_stock_position'](F(f'{D}/pos.txt'))
op = ns['apply_position_adjustment_to_op'](op_raw, pos)
lrs = ns['load_lr_belum_settle'](F(f'{D}/lrsettle.txt'))
op = ns['apply_lr_adjustment_to_op'](op, lrs)
netting, cid_to_sid, sid_to_name = ns['parse_netting_invoice'](f'{D}/netting.xlsx')
net_buy, net_sell = ns['split_netting'](netting, closing)
cl_data, cl_vdate = ns['parse_credit_limit_file'](open(f'{D}/cl.txt').read())
st.session_state.update(shared_closing_prices=closing, shared_risk_params=hc, shared_risk_avail_qty=avq, shared_op_data=op,
    shared_net_buy=net_buy, shared_net_sell=net_sell, shared_cl_data=cl_data)

# 2) loop TRX PEI asli (dipotong dari blok tombol, di-dedent)
a = idx("                    closing_prices  = st.session_state['shared_closing_prices']")
b = idx("                st.session_state['pei_results'] = results")
ns2 = dict(ns); ns2.update(file_sid_client=f'{D}/sidclient.xlsx')
exec(textwrap.dedent('\n'.join(lines[a:b])), ns2)
pei_results = ns2['results']

# 3) Validasi MNC asli
a = idx('    def validate_sid_mnc'); b = idx('    # ── TOMBOL VALIDASI')
exec(textwrap.dedent('\n'.join(lines[a:b])), ns)
df_sid = ns['find_and_rename'](pd.read_excel(f'{D}/sidclient.xlsx', dtype=str))
sid_to_cid = df_sid.set_index('sid_key')['cid_key'].to_dict()
cid_to_name = df_sid.drop_duplicates('cid_key').set_index('cid_key')['name_key'].to_dict()
# sheet LR "Hasil MNC" sintetis (kolom 0=SID, 1=saham, 4=avail, 13=vol) utk LR-1
import random; random.seed(11)
hb = []
for sid, stocks in net_buy.items():
    for s, bd in stocks.items():
        a_ = random.choice([0, bd['lot']-1, bd['lot'], bd['lot']*3, 9e9])
        row = [sid, s, 0, 0, a_] + [0]*8 + [bd['lot']]
        hb.append(row)
df_buy = pd.DataFrame(hb, columns=[f'c{i}' for i in range(14)])
json.dump(hb, open(f'{D}/hasil_buy.json', 'w'))
all_sids = sorted(set(list(op.keys()) + list(cl_data.keys()) + list(net_buy.keys()) + list(net_sell.keys())))
sid_results = {}
for sid in all_sids:
    sid_results[sid] = ns['validate_sid_mnc'](sid, op, cl_data, net_sell, net_buy, closing, hc, None, df_buy, avq,
                                              sid_to_cid_map=sid_to_cid, cid_to_name_map=cid_to_name)
# 4) generator iFast asli
a = idx('            def gen_rp_excel'); b = idx('            e1, e2 = st.columns(2)')
ns3 = dict(ns); ns3.update(sid_results=sid_results)
exec(textwrap.dedent('\n'.join(lines[a:b])), ns3)
def sheets(buf): return {k: v.to_dict('records') for k, v in pd.read_excel(buf, sheet_name=None).items()}
ifast = {'rp': sheets(ns3['gen_rp_excel']()), 'lr': sheets(ns3['gen_lr_excel']())}
# global
tl = sum(d['max_lr_final'] for d in sid_results.values() if ns['lolos_lr'](d))
tr = sum(d['total_rp_maks'] for d in sid_results.values() if ns['lolos_rp'](d))
def clean(o):
    if isinstance(o, dict): return {str(k): clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)): return [clean(x) for x in o]
    if hasattr(o, 'item'): return o.item()
    if isinstance(o, float) and o != o: return None
    return o
slim = lambda r: {k: v for k, v in r.items() if k != 'checks'}
out = {
  'closing': closing, 'op': {k: v for k, v in op.items()}, 'net_buy': net_buy, 'net_sell': net_sell,
  'pei': {k: slim(v) for k, v in pei_results.items()},
  'mnc': {k: slim(v) for k, v in sid_results.items()},
  'mnc_checks': {k: [(c['label'], c['passed']) for c in v['checks']] for k, v in sid_results.items()},
  'lolos_rp': {k: ns['lolos_rp'](v) for k, v in sid_results.items()},
  'lolos_lr': {k: ns['lolos_lr'](v) for k, v in sid_results.items()},
  'ifast': ifast, 'global': {'rp': tr, 'lr': tl},
}
json.dump(clean(out), open(f'{D}/python_ref.json', 'w'))
print('python ref ok:', len(pei_results), 'pei,', len(sid_results), 'mnc sid')

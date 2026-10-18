"""Data sintetis untuk tes pembanding (BUKAN data MNC asli). Ada kasus tepi yang disengaja."""
import random, os, pandas as pd, json
random.seed(7)
OUT = os.path.join(os.path.dirname(__file__), 'data'); os.makedirs(OUT, exist_ok=True)
stocks = ['BBCA','BBRI','TLKM','ASII','GOTO','BMRI','UNVR','ICBP','ANTM','MDKA','PTBA','ADRO']
price = {s: random.choice([1200,2450,3800,5125,9250,380,6700]) for s in stocks}
no_price = 'MDKA'  # sengaja TIDAK ada di closing price
with open(f'{OUT}/risk.txt','w') as f:
    f.write('StockCode|Name|Haircut|AvailableQuantity\n')
    for s in stocks:
        f.write(f'{s}|{s} Tbk|{random.choice([0,10,20,30,50])}|{random.choice([0,5000,200000,9000000])}\n')
pd.DataFrame({'no_share':[s for s in stocks if s!=no_price]+['',None],
              'kurs_now':[price[s] for s in stocks if s!=no_price]+[1,'x']}).to_excel(f'{OUT}/closing.xlsx', index=False)

sids = [f'IDD{random.randint(100000,999999)}' for _ in range(40)]
names = {s: f'NASABAH {i}' for i,s in enumerate(sids)}
op = []; cl = ['Value Date|Broker Code|SID|Client Name|Client Credit Limit|Used Limit|Available Limit']
loan_of = {}
for i,s in enumerate(sids):
    if i == 37: continue                      # tidak ada di OP
    loan = 0 if i % 7 == 3 else random.choice([5e6, 80e6, 250e6, 1.2e9, 3e9])
    loan_of[s] = loan
    op.append(f'0|X|Y|{s}|{names[s]}|{loan}|{loan*0.002:.2f}|0')
    for st in random.sample(stocks, random.randint(0,4)):
        op.append(f'1|X|{s}|{st}|{random.choice([100,2000,15000,80000])}')
    cl.append(f'2026/10/16|EP|{s}|{names[s]}|{random.choice([1e9,5e9])}|0|{random.choice([0,20e6,300e6,2e9,10e9]):,.0f}'.replace(',', '') )
open(f'{OUT}/op.txt','w').write('\n'.join(op)+'\n')
open(f'{OUT}/cl.txt','w').write('\n'.join(cl)+'\n')

rows = []
for i,s in enumerate(sids):
    if i in (38,39) and False: continue
    cid = f'C{i:05d}'
    for _ in range(0 if i == 5 else random.randint(0, 9 if i % 5 else 25)):   # beberapa nasabah sangat sering transaksi
        st = random.choice(stocks)
        side = random.choice(['B','S'])
        vol = random.choice([100,500,1000,2500,10000])
        rows.append({'SID':s,'no_cust':cid,'no_share':st,'bors':side,'tot_vol':f'{vol:,}',
                     'amt_done':f'{vol*price.get(st,1000):,}','board':random.choice(['RG']*9+['TN']),
                     'lorf':random.choice(['D']*9+['F']),'name':names[s]})
    if i == 5:   # beli & jual sama persis -> netting nol (kasus 'Firbert')
        for sd in 'BS': rows.append({'SID':s,'no_cust':cid,'no_share':'BBCA','bors':sd,'tot_vol':'1000','amt_done':'5000000','board':'RG','lorf':'D','name':names[s]})
pd.DataFrame(rows).to_excel(f'{OUT}/netting.xlsx', index=False)
pd.DataFrame(rows).to_csv(f'{OUT}/netting.csv', index=False)

pei = [s for i,s in enumerate(sids) if i % 6 != 4]          # sebagian bukan PEI
pd.DataFrame({'SID':pei,'no_cust':[f'C{sids.index(s):05d}' for s in pei],'Name':[names[s] for s in pei]}).to_excel(f'{OUT}/sidclient.xlsx', index=False)

pos = ['Date|Broker Code|SID|Name|Stock Code|Quantity On Hand|Hold|Commit Receive|Commit Deliver|ReqDeliver|ReqReceive|Balance|Corpact|AfterCorpact']
for s in random.sample(sids, 8):
    pos.append(f'2026/10/16|EP|{s}|{names[s]}|{random.choice(stocks)}|0|0|{random.choice([0,1000,5000])}|{random.choice([0,500,3000])}|0|0|0|0|0')
open(f'{OUT}/pos.txt','w').write('\n'.join(pos)+'\n')
lrs = [f'0|EP|{s}|LR{i}|20261015|20261017|20261030|{random.choice([10e6,75e6])}' for i,s in enumerate(random.sample(sids,6))]
open(f'{OUT}/lrsettle.txt','w').write('\n'.join(lrs)+'\n')
json.dump({'sids':sids}, open(f'{OUT}/meta.json','w'))
print('data ok', len(rows), 'trx rows,', len(sids), 'sid')

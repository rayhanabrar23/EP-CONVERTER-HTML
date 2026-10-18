# PEI Generator (versi HTML + login) — MNC Sekuritas

Port dari `pages/Daily RP and LR Calculation.py` (Streamlit). Semua perhitungan jalan di browser; server (Cloudflare Pages Functions) hanya mengurus login dan log audit. **Berkas nasabah tidak pernah diunggah ke server.**

## Struktur
```
public/            frontend statis (index.html, app.js, core.js, login.*, vendor/xlsx)
functions/         login, gerbang semua halaman, audit (Cloudflare Pages Functions)
tools/hash-password.mjs   pembuat hash password
tests/             tes pembanding vs Python asli, tes perilaku, tes auth, tes UI
```

## Deploy (GitHub → Cloudflare Pages)
1. Taruh isi folder ini di **branch baru** (mis. `html-version`), jangan di `main` — Streamlit yang dipakai MNC tetap aman.
2. Cloudflare → Workers & Pages → Create → Pages → Connect to Git → pilih repo & branch. Framework: *None*. Build command: *(kosong)*. Output directory: `public`.
3. Settings → Variables and Secrets (Production), tipe **Secret**:
   - `SESSION_SECRET` — string acak ≥ 32 karakter (`openssl rand -base64 48`).
   - `USERS_JSON` — array JSON user, mis. `[{"u":"rayhan","role":"PEI","salt":"…","hash":"…","iter":100000}, {"u":"mnc1","role":"MNC",…}]`. Buat tiap entri dengan: `node tools/hash-password.mjs rayhan PEI` (password minimal 10 karakter).
4. (Opsional) Log audit permanen: buat KV namespace, bind dengan nama `AUDIT` (Settings → Functions → KV bindings).
5. (Disarankan) Cloudflare → Security → WAF → Rate limiting rule untuk `POST /api/login` (mis. 5 percobaan/menit/IP). Tanpa ini hanya ada jeda 0,6 detik per percobaan gagal.
6. Deploy ulang. Ganti password = ganti entri di `USERS_JSON`, lalu deploy ulang.

## Peran
- **PEI**: upload, edit RP/LR Final, Auto-Adjust, export, lihat log audit server.
- **MNC**: hanya lihat dan unduh (tidak bisa edit). *Asumsi — belum dikonfirmasi; ubah di `canEdit()` pada `app.js` bila MNC juga perlu edit.*

## Menjalankan tes
```
npm install
python3 tests/gen_data.py && python3 tests/ref_python.py   # perlu repo Streamlit di /home/claude/repo
node tests/compare.js      # port JS vs kode Python asli
node tests/behavior.js     # edit→iFast, diagnostik, CSV=XLSX
node tests/auth.test.mjs   # login, cookie, CSRF
node tests/ui.test.js      # alur UI end-to-end (jsdom)
```

## Catatan perilaku (penting)
- **Satu sumber kebenaran**: RP Final / LR Final yang diedit disimpan di state dan dibaca oleh Validasi, file iFast, dan Hasil_TRX_PEI. Rerun tidak mereset editan.
- RP yang dipotong terlalu kecil bisa membuat check **RP-3 (rasio < 65%)** gagal sehingga nasabah **keluar dari file iFast**. Ini perilaku validasi asli; sekarang terlihat di tab Validasi dan Diagnostik.
- Dua mode hitung dipertahankan persis seperti Python: tab TRX PEI (`pei`) dan Validasi (`mnc`). Bedanya hanya untuk nasabah yang menjual tetapi Loan Existing = 0 (di mode `pei` saham terjual tetap mengurangi kolateral untuk hitung LR). Perlu keputusan apakah disatukan.
- Tanpa file Hasil MNC, check LR-1 memakai Available Qty dari Risk Parameter (di Python, LR-1 membaca kolom sheet Hasil MNC).

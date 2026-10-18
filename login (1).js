document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault(); const err = document.getElementById('err'); err.textContent = '';
  const fd = new FormData(e.target); const btn = e.target.querySelector('button'); btn.disabled = true;
  try {
    const r = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: fd.get('username'), password: fd.get('password') }) });
    if (r.ok) location.href = '/'; else err.textContent = (await r.json().catch(() => ({}))).error || 'Gagal masuk';
  } catch { err.textContent = 'Tidak dapat menghubungi server'; }
  btn.disabled = false;
});

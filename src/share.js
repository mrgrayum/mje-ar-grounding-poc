// "Share" sheet used by the library and the model pages: copy link, phone share, QR code, embed code.
// MJE brand: black + MJE Yellow #FFEF00, Segoe UI.
import qrcode from 'qrcode-generator'

const CSS = `
.sh-back{position:fixed;inset:0;z-index:900;background:rgba(0,0,0,.62);display:flex;align-items:flex-end;justify-content:center;
  font-family:'Segoe UI',system-ui,-apple-system,Arial,sans-serif;opacity:0;transition:opacity .2s}
.sh-back.on{opacity:1}
.sh-back *{box-sizing:border-box}
.sh-card{width:min(440px,100%);max-height:92vh;overflow:auto;background:#fff;color:#000;border-radius:18px 18px 0 0;
  padding:0 0 calc(18px + env(safe-area-inset-bottom));transform:translateY(24px);transition:transform .2s;
  border-top:5px solid #FFEF00;touch-action:pan-y}
.sh-back.on .sh-card{transform:none}
@media(min-width:560px){.sh-back{align-items:center}.sh-card{border-radius:16px;padding-bottom:18px}}
.sh-head{display:flex;align-items:center;gap:10px;padding:16px 18px 6px}
.sh-head h2{flex:1;margin:0;font-size:19px;font-weight:700}
.sh-x{width:40px;height:40px;border:0;border-radius:50%;background:#F4F4F4;color:#000;font-size:24px;line-height:1;cursor:pointer}
.sh-sub{padding:0 18px;color:#333;font-size:14px;overflow-wrap:anywhere}
.sh-row{display:flex;gap:8px;padding:14px 18px 0}
.sh-link{flex:1;min-width:0;height:46px;border:1px solid #D0D0D0;border-radius:10px;padding:0 12px;font:inherit;font-size:14px;color:#333;background:#F4F4F4}
.sh-btn{height:46px;padding:0 18px;border:0;border-radius:10px;background:#FFEF00;color:#000;font:inherit;font-weight:700;font-size:15px;cursor:pointer;white-space:nowrap}
.sh-btn:active{background:#E6D700}
.sh-btn.alt{background:#000;color:#fff}
.sh-qr{display:flex;gap:14px;align-items:center;margin:16px 18px 0;padding:12px;border-radius:12px;background:#F4F4F4}
.sh-qr img{width:116px;height:116px;flex:none;image-rendering:pixelated;background:#fff;border-radius:8px}
.sh-qr p{margin:0;font-size:14px;color:#333;line-height:1.4}
.sh-qr b{display:block;color:#000;margin-bottom:2px}
.sh-embed{margin:14px 18px 0;font-size:14px}
.sh-embed summary{cursor:pointer;font-weight:600;padding:6px 0;color:#000}
.sh-embed textarea{width:100%;height:96px;margin-top:6px;border:1px solid #D0D0D0;border-radius:10px;padding:10px;font:12px/1.4 Consolas,monospace;color:#333;background:#F4F4F4;resize:none}
.sh-embed .sh-btn{margin-top:8px;height:40px;font-size:14px}
.sh-focus .sh-qr{outline:3px solid #FFEF00}
`

let injected = false
const inject = () => {
  if (injected) return
  injected = true
  const s = document.createElement('style')
  s.textContent = CSS
  document.head.appendChild(s)
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch (e) {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.cssText = 'position:fixed;left:-999px;top:0'
    document.body.appendChild(ta)
    ta.select()
    let ok = false
    try { ok = document.execCommand('copy') } catch (err) { ok = false }
    ta.remove()
    return ok
  }
}

export const qrDataUrl = (text) => {
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  return qr.createDataURL(6, 2)
}

// opts: {title, url, embedUrl?, focusQr?: bool, note?: string}
export function openShareSheet({title, url, embedUrl = '', focusQr = false, note = ''}) {
  inject()
  const back = document.createElement('div')
  back.className = 'sh-back' + (focusQr ? ' sh-focus' : '')
  back.setAttribute('role', 'dialog')
  back.setAttribute('aria-modal', 'true')
  const card = document.createElement('div')
  card.className = 'sh-card'
  back.appendChild(card)

  const head = document.createElement('div')
  head.className = 'sh-head'
  head.innerHTML = '<h2>Share</h2><button class="sh-x" type="button" aria-label="Close">&times;</button>'
  card.appendChild(head)
  const sub = document.createElement('div')
  sub.className = 'sh-sub'
  sub.textContent = note || title || ''
  card.appendChild(sub)

  const row = document.createElement('div')
  row.className = 'sh-row'
  const input = document.createElement('input')
  input.className = 'sh-link'
  input.readOnly = true
  input.value = url
  input.setAttribute('aria-label', 'Link')
  input.addEventListener('focus', () => input.select())
  const copy = document.createElement('button')
  copy.className = 'sh-btn'
  copy.type = 'button'
  copy.textContent = 'Copy link'
  const flash = (btn, text) => {
    const old = btn.dataset.label || btn.textContent
    btn.dataset.label = old
    btn.textContent = text
    setTimeout(() => { btn.textContent = old }, 1600)
  }
  copy.addEventListener('click', async () => flash(copy, (await copyText(url)) ? 'Copied!' : 'Press Ctrl+C'))
  row.append(input, copy)
  card.appendChild(row)

  if (navigator.share) {
    const r2 = document.createElement('div')
    r2.className = 'sh-row'
    const b = document.createElement('button')
    b.className = 'sh-btn alt'
    b.type = 'button'
    b.style.flex = '1'
    b.textContent = 'Share…'
    b.addEventListener('click', () => { navigator.share({title: title || 'MJE model', url}).catch(() => {}) })
    r2.appendChild(b)
    card.appendChild(r2)
  }

  const qr = document.createElement('div')
  qr.className = 'sh-qr'
  try {
    const img = document.createElement('img')
    img.alt = 'QR code for the link'
    img.src = qrDataUrl(url)
    const p = document.createElement('p')
    p.innerHTML = '<b>Open on your phone</b>Point your phone camera at this code. On a phone you can also view the model in AR.'
    qr.append(img, p)
    card.appendChild(qr)
  } catch (e) { /* link too long for a QR code: skip it */ }

  if (embedUrl) {
    const code = `<iframe src="${embedUrl}" width="100%" height="480" style="border:0;border-radius:8px" `
      + 'allow="fullscreen; accelerometer; gyroscope" loading="lazy" title="' + String(title || '3D model').replace(/"/g, '&quot;') + '"></iframe>'
    const d = document.createElement('details')
    d.className = 'sh-embed'
    d.innerHTML = '<summary>Embed on a website</summary>'
    const ta = document.createElement('textarea')
    ta.readOnly = true
    ta.value = code
    ta.addEventListener('focus', () => ta.select())
    const cb = document.createElement('button')
    cb.className = 'sh-btn'
    cb.type = 'button'
    cb.textContent = 'Copy embed code'
    cb.addEventListener('click', async () => flash(cb, (await copyText(code)) ? 'Copied!' : 'Press Ctrl+C'))
    d.append(ta, cb)
    card.appendChild(d)
  }

  const close = () => {
    back.classList.remove('on')
    document.removeEventListener('keydown', onKey)
    setTimeout(() => back.remove(), 200)
  }
  const onKey = (e) => { if (e.key === 'Escape') close() }
  document.addEventListener('keydown', onKey)
  head.querySelector('.sh-x').addEventListener('click', close)
  back.addEventListener('click', (e) => { if (e.target === back) close() })
  // Taps inside the sheet must never reach the 3D view underneath.
  ;['pointerdown', 'pointerup'].forEach(t => back.addEventListener(t, e => e.stopPropagation()))
  document.body.appendChild(back)
  requestAnimationFrame(() => back.classList.add('on'))
  return close
}

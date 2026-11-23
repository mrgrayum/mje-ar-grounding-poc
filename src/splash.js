// M. J. Electric branded splash screen shown while an AR or 3D experience loads.
// Brand rules: MJE Yellow #FFEF00 + Black #000000, Segoe UI, diagonal shapes, motto footer.
// The logo artwork is never redrawn here: a supplied logo image is shown as-is; without one the
// company name is set in type.

const CSS = `
.mje-splash{position:fixed;inset:0;z-index:700;background:#000;color:#fff;display:flex;flex-direction:column;
  align-items:center;justify-content:center;text-align:center;overflow:hidden;
  font-family:'Segoe UI',system-ui,-apple-system,Arial,sans-serif;transition:opacity .55s ease}
.mje-splash.out{opacity:0;pointer-events:none}
.mje-splash *{box-sizing:border-box}
.mje-tri{position:absolute;pointer-events:none}
.mje-tri.a{right:0;top:0;width:78%;height:46%;background:#1a1a1a;clip-path:polygon(100% 0,100% 100%,0 0)}
.mje-tri.b{left:0;bottom:0;width:100%;height:24%;background:#FFEF00;clip-path:polygon(0 52%,100% 0,100% 100%,0 100%)}
.mje-tri.c{left:0;bottom:0;width:100%;height:29%;background:#333;clip-path:polygon(0 60%,100% 0,100% 18%,0 82%);opacity:.9}
.mje-main{position:relative;z-index:2;width:100%;padding:0 24px;display:flex;flex-direction:column;align-items:center}
.mje-logo{display:block;max-width:min(80vw,380px);max-height:36vh;width:auto;height:auto;object-fit:contain}
.mje-word{font-weight:800;letter-spacing:.16em;font-size:clamp(26px,8vw,46px);line-height:1.1}
.mje-bar-y{width:64px;height:5px;background:#FFEF00;margin:14px auto 0}
.mje-title{margin-top:26px;font-weight:600;font-size:clamp(17px,4.6vw,22px);max-width:86vw;overflow-wrap:anywhere}
.mje-status{margin-top:10px;font-size:13px;color:#bdbdbd;min-height:1.2em;max-width:86vw}
.mje-prog{margin-top:14px;width:min(62vw,260px);height:4px;background:#333;overflow:hidden;border-radius:2px}
.mje-prog i{display:block;height:100%;width:0;background:#FFEF00;transition:width .25s ease}
.mje-prog.ind i{width:38%;animation:mje-slide 1.15s ease-in-out infinite}
@keyframes mje-slide{0%{transform:translateX(-110%)}100%{transform:translateX(280%)}}
.mje-err .mje-status{color:#FFEF00}
.mje-motto{position:absolute;z-index:3;left:0;right:0;bottom:calc(14px + env(safe-area-inset-bottom));
  font-weight:700;font-size:clamp(10px,2.9vw,13px);letter-spacing:.2em;color:#000;white-space:nowrap}
`

let injected = false
const inject = () => {
  if (injected) return
  injected = true
  const s = document.createElement('style')
  s.textContent = CSS
  document.head.appendChild(s)
}

const MIN_VISIBLE_MS = 1500

export function createSplash(parent = document.body, brand = {}) {
  inject()
  const el = document.createElement('div')
  el.className = 'mje-splash'
  el.innerHTML = '<div class="mje-tri a"></div><div class="mje-tri c"></div><div class="mje-tri b"></div>'
    + '<div class="mje-main"><div class="mje-mark"></div><div class="mje-title"></div>'
    + '<div class="mje-prog ind"><i></i></div><div class="mje-status">Loading…</div></div>'
    + '<div class="mje-motto">INTEGRITY &bull; INSPIRED &bull; INVESTED</div>'
  parent.appendChild(el)

  const q = sel => el.querySelector(sel)
  const t0 = performance.now()
  const hold = new URLSearchParams(location.search).get('splash') === 'hold' // for design checks

  const setLogo = (src) => {
    const mark = q('.mje-mark')
    mark.textContent = ''
    if (src) {
      const img = document.createElement('img')
      img.className = 'mje-logo'
      img.alt = 'M. J. Electric'
      img.onerror = () => setLogo('') // fall back to the typed name if the file is missing
      img.src = src
      mark.appendChild(img)
    } else {
      mark.innerHTML = '<div class="mje-word">M. J. ELECTRIC</div><div class="mje-bar-y"></div>'
    }
  }
  const setTitle = (t) => { q('.mje-title').textContent = t || '' }
  const setStatus = (t) => { q('.mje-status').textContent = t || '' }
  const setProgress = (p) => {
    const bar = q('.mje-prog')
    if (p == null) { bar.classList.add('ind'); return }
    bar.classList.remove('ind')
    q('.mje-prog i').style.width = `${Math.round(Math.min(Math.max(p, 0), 1) * 100)}%`
  }

  setLogo(brand.logo || '')
  setTitle(brand.title || '')

  return {
    el,
    setLogo,
    setTitle,
    setStatus,
    setProgress,
    error(msg) {
      el.classList.add('mje-err')
      q('.mje-prog').style.display = 'none'
      setStatus(msg)
    },
    hide() {
      if (hold) return
      const wait = Math.max(0, MIN_VISIBLE_MS - (performance.now() - t0))
      setTimeout(() => {
        el.classList.add('out')
        setTimeout(() => el.remove(), 700)
      }, wait)
    },
  }
}

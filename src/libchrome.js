// Library mode: when a model page is opened from the library (?m=<slug>), it gets the MJE top bar
// (back to library, title, Share), a 3D / AR switch and, when embedded in another site, a slim variant.
import {openShareSheet} from './share.js'
import {isPhoneOrTablet} from './core.js'

// Returns null for a stand-alone published folder (the original single-model layout).
export function libContext() {
  const p = new URLSearchParams(location.search)
  const slug = (p.get('m') || '').toLowerCase().replace(/[^a-z0-9-]/g, '')
  if (!slug) return null
  return {
    slug,
    base: `models/${slug}/`,
    embed: p.get('embed') === '1',
    libUrl: 'index.html',
    viewUrl: `view.html?m=${slug}`,
    arUrl: `ar.html?m=${slug}`,
  }
}

const abs = rel => new URL(rel, location.href).href

const CSS = `
.lc-bar{position:absolute;left:0;right:0;top:0;z-index:22;display:flex;align-items:center;gap:10px;
  height:calc(52px + env(safe-area-inset-top));padding:env(safe-area-inset-top) 10px 0 6px;background:#000;color:#fff;
  border-bottom:3px solid #FFEF00;pointer-events:auto;font-family:'Segoe UI',system-ui,-apple-system,Arial,sans-serif}
.lc-bar *{box-sizing:border-box}
.lc-back{display:flex;align-items:center;gap:2px;height:44px;padding:0 8px 0 2px;color:#FFEF00;text-decoration:none;font-weight:600;font-size:15px;flex:none}
.lc-back svg{width:26px;height:26px;fill:none;stroke:currentColor;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
.lc-logo{height:38px;width:auto;flex:none}
.lc-title{flex:1;min-width:0;font-weight:700;font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lc-share{display:flex;align-items:center;gap:7px;height:38px;padding:0 14px;border:0;border-radius:999px;background:#FFEF00;color:#000;
  font:700 14px 'Segoe UI',system-ui,Arial,sans-serif;cursor:pointer;flex:none;touch-action:manipulation}
.lc-share:active{background:#E6D700}
.lc-share svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
@media(max-width:460px){.lc-back span{display:none}.lc-title{font-size:15px}}
@media(max-width:340px){.lc-share span{display:none}.lc-share{padding:0 11px}}
.lc-toggle{position:absolute;left:14px;top:calc(64px + env(safe-area-inset-top));z-index:26;display:flex;border-radius:12px;overflow:hidden;
  background:rgba(0,0,0,.82);pointer-events:auto;box-shadow:0 4px 14px rgba(0,0,0,.3);font-family:'Segoe UI',system-ui,Arial,sans-serif}
.lc-toggle button{height:42px;padding:0 16px;border:0;background:transparent;color:#fff;font:600 14px 'Segoe UI',system-ui,Arial,sans-serif;cursor:pointer;touch-action:manipulation}
.lc-toggle button.on{background:#FFEF00;color:#000}
.lc-pill{position:absolute;left:12px;top:calc(12px + env(safe-area-inset-top));z-index:26;display:flex;align-items:center;gap:6px;height:38px;padding:0 14px;
  border-radius:999px;background:#000;color:#FFEF00;text-decoration:none;font:700 13px 'Segoe UI',system-ui,Arial,sans-serif;pointer-events:auto;box-shadow:0 4px 14px rgba(0,0,0,.3)}
.lc-pill + .lc-pill{left:auto;right:auto;top:calc(56px + env(safe-area-inset-top))}
.lib-mode .mk-ui .mk-menu-btn{top:calc(64px + env(safe-area-inset-top))}
.lib-mode .mk-ui .mk-title{display:none}
.lib-mode .mk-list{padding-top:0}
.lib-embed .mk-ui .mk-menu-btn{top:calc(12px + env(safe-area-inset-top))}
`

let injected = false
const inject = () => {
  if (injected) return
  injected = true
  const s = document.createElement('style')
  s.textContent = CSS
  document.head.appendChild(s)
}

const CHEV = '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>'
const SHARE = '<svg viewBox="0 0 24 24"><path d="M12 15V3M7 8l5-5 5 5M5 13v6a2 2 0 002 2h10a2 2 0 002-2v-6"/></svg>'

// page: '3d' | 'ar'.  canAR: the project was published as an AR experience.
export function addLibraryChrome(parent, ctx, {title = '', page = '3d', canAR = false} = {}) {
  inject()
  document.documentElement.classList.add('lib-mode')
  if (ctx.embed) document.documentElement.classList.add('lib-embed')
  const phone = isPhoneOrTablet()
  const stop = el => ['pointerdown', 'pointerup'].forEach(t => el.addEventListener(t, e => e.stopPropagation()))

  if (ctx.embed) {
    // Slim variant for other websites: a link to the full page, and AR on phones (camera is not allowed in frames).
    const full = document.createElement('a')
    full.className = 'lc-pill'
    full.href = abs(ctx.viewUrl)
    full.target = '_blank'
    full.rel = 'noopener'
    full.textContent = 'Open full page ↗'
    parent.appendChild(full)
    stop(full)
    if (canAR && phone) {
      const ar = document.createElement('a')
      ar.className = 'lc-pill'
      ar.href = abs(ctx.arUrl)
      ar.target = '_blank'
      ar.rel = 'noopener'
      ar.textContent = 'View in AR'
      parent.appendChild(ar)
      stop(ar)
    }
    return
  }

  const bar = document.createElement('div')
  bar.className = 'lc-bar'
  bar.innerHTML = `<a class="lc-back" href="${ctx.libUrl}" aria-label="Back to the library">${CHEV}<span>Library</span></a>`
    + '<img class="lc-logo" src="logo.png" alt="M. J. Electric">'
    + '<div class="lc-title"></div>'
    + `<button class="lc-share" type="button" aria-label="Share this model">${SHARE}<span>Share</span></button>`
  bar.querySelector('.lc-title').textContent = title
  bar.querySelector('.lc-logo').addEventListener('error', e => e.target.remove())
  parent.appendChild(bar)
  stop(bar)

  const share = (focusQr = false, note = '') => openShareSheet({
    title,
    url: abs(ctx.viewUrl),
    embedUrl: abs(`${ctx.viewUrl}&embed=1`),
    focusQr,
    note,
  })
  bar.querySelector('.lc-share').addEventListener('click', () => share())

  if (canAR) {
    const tg = document.createElement('div')
    tg.className = 'lc-toggle'
    tg.innerHTML = `<button type="button" data-v="3d"${page === '3d' ? ' class="on"' : ''}>3D view</button>`
      + `<button type="button" data-v="ar"${page === 'ar' ? ' class="on"' : ''}>View in AR</button>`
    parent.appendChild(tg)
    stop(tg)
    tg.addEventListener('click', (e) => {
      const b = e.target.closest('button')
      if (!b || b.dataset.v === page) return
      if (b.dataset.v === 'ar') {
        if (phone) location.href = ctx.arUrl
        else share(true, 'AR needs a phone or tablet camera. Scan this code with your phone to view the model in AR.')
      } else {
        location.href = ctx.viewUrl
      }
    })
  }
}

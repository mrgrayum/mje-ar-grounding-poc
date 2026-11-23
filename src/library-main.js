// The model library page: a searchable grid of published 3D / AR models.
// MJE brand: black + MJE Yellow #FFEF00, Segoe UI, diagonal shapes, motto footer (Brand Manual rev. 7).
import {openShareSheet} from './share.js'
import {lockZoom} from './zoomlock.js'

const CSS = `
:root{--y:#FFEF00;--yd:#E6D700;--k:#000;--g1:#F4F4F4;--g3:#D0D0D0;--g5:#7A7A7A;--g7:#333}
*{box-sizing:border-box}
html,body{margin:0;background:var(--g1);color:var(--k);-webkit-text-size-adjust:100%}
body{font-family:'Segoe UI',system-ui,-apple-system,Arial,sans-serif;font-size:16px;line-height:1.45;min-height:100vh;display:flex;flex-direction:column}
a{color:inherit}
:focus-visible{outline:3px solid var(--y);outline-offset:2px;box-shadow:0 0 0 5px #000}
.lb-head{position:relative;background:#000;color:#fff;overflow:hidden;border-bottom:5px solid var(--y)}
.lb-head::before{content:'';position:absolute;right:0;top:0;width:62%;height:100%;background:#161616;clip-path:polygon(100% 0,100% 100%,0 100%,38% 0)}
.lb-head::after{content:'';position:absolute;right:0;top:0;width:34%;height:100%;background:#262626;clip-path:polygon(100% 0,100% 100%,22% 100%,60% 0)}
.lb-wrap{position:relative;z-index:2;max-width:1160px;margin:0 auto;padding:0 20px}
.lb-top{display:flex;align-items:center;gap:16px;padding:calc(16px + env(safe-area-inset-top)) 0 18px}
.lb-logo{height:68px;width:auto;flex:none}
.lb-kick{color:var(--y);font-weight:700;letter-spacing:.18em;font-size:12px;text-transform:uppercase}
.lb-head h1{margin:2px 0 0;font-size:clamp(24px,5.4vw,38px);line-height:1.1;font-weight:700}
.lb-grow{flex:1}
.lb-share{display:flex;align-items:center;gap:8px;height:44px;padding:0 18px;border:0;border-radius:999px;background:var(--y);color:#000;font-weight:700;font-size:15px;font-family:inherit;cursor:pointer;flex:none;touch-action:manipulation}
.lb-share:active{background:var(--yd)}
.lb-share svg,.lb-cs svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
.lb-sub{margin:0;padding:0 0 22px;color:#d6d6d6;font-size:15px;max-width:600px}
.lb-tools{position:sticky;top:0;z-index:5;background:var(--g1);border-bottom:1px solid var(--g3)}
.lb-tools .lb-wrap{padding-top:14px;padding-bottom:12px}
.lb-search{position:relative}
.lb-search svg{position:absolute;left:14px;top:50%;transform:translateY(-50%);width:20px;height:20px;fill:none;stroke:var(--g5);stroke-width:2.4;stroke-linecap:round}
.lb-search input{width:100%;height:50px;border:2px solid var(--g3);border-radius:12px;padding:0 14px 0 44px;font:inherit;font-size:16px;background:#fff;color:#000;-webkit-appearance:none;appearance:none}
.lb-search input:focus{border-color:#000;outline:none;box-shadow:0 0 0 3px var(--y)}
.lb-chips{display:flex;gap:8px;overflow-x:auto;padding:12px 2px 2px;scrollbar-width:none;-webkit-overflow-scrolling:touch}
.lb-chips::-webkit-scrollbar{display:none}
.lb-chip{flex:none;height:38px;padding:0 15px;border:2px solid var(--g3);border-radius:999px;background:#fff;color:var(--g7);font-weight:600;font-size:14px;font-family:inherit;cursor:pointer;touch-action:manipulation;white-space:nowrap}
.lb-chip small{opacity:.6;font-weight:600;margin-left:5px}
.lb-chip.on{background:#000;border-color:#000;color:var(--y)}
.lb-main{flex:1;max-width:1160px;width:100%;margin:0 auto;padding:18px 20px 30px}
.lb-count{color:var(--g5);font-size:14px;margin:0 0 12px}
.lb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:18px}
@media(max-width:560px){.lb-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.lb-logo{height:54px}.lb-share span{display:none}.lb-share{width:44px;padding:0;justify-content:center}.lb-top{gap:12px}}
@media(max-width:360px){.lb-grid{grid-template-columns:1fr}}
.lb-card{position:relative;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.12);transition:transform .15s,box-shadow .15s}
@media(hover:hover){.lb-card:hover{transform:translateY(-3px);box-shadow:0 10px 24px rgba(0,0,0,.18)}}
.lb-link{display:block;text-decoration:none;color:inherit;-webkit-tap-highlight-color:transparent}
.lb-img{position:relative;aspect-ratio:4/3;background:#E9E9E9 linear-gradient(135deg,#efefef,#dcdcdc);display:grid;place-items:center;overflow:hidden}
.lb-img img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.lb-img svg{width:42%;max-width:90px;fill:none;stroke:#9a9a9a;stroke-width:1.6;stroke-linejoin:round}
.lb-badge{position:absolute;left:10px;top:10px;padding:3px 10px;border-radius:999px;background:var(--y);color:#000;font-weight:800;font-size:12px;letter-spacing:.08em}
.lb-body{padding:12px 14px 14px}
.lb-body h3{margin:0;font-size:17px;line-height:1.25;font-weight:700;overflow-wrap:anywhere}
.lb-body p{margin:5px 0 0;font-size:14px;color:var(--g7);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.lb-tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.lb-tag{padding:2px 9px;border-radius:999px;background:var(--g1);color:var(--g7);font-size:12px;font-weight:600}
.lb-cs{position:absolute;right:8px;top:8px;width:40px;height:40px;border:0;border-radius:50%;background:rgba(0,0,0,.78);color:#fff;display:grid;place-items:center;cursor:pointer;touch-action:manipulation}
.lb-cs:active{background:#000;color:var(--y)}
.lb-cs svg{width:18px;height:18px}
.lb-empty{text-align:center;padding:50px 16px;color:var(--g7)}
.lb-empty b{display:block;font-size:19px;color:#000;margin-bottom:6px}
.lb-empty button{margin-top:14px;height:44px;padding:0 20px;border:0;border-radius:999px;background:#000;color:var(--y);font-weight:700;font-size:15px;font-family:inherit;cursor:pointer}
.lb-foot{background:#000;color:#fff;text-align:center;padding:20px 16px calc(20px + env(safe-area-inset-bottom));border-top:5px solid var(--y)}
.lb-motto{font-weight:700;letter-spacing:.2em;font-size:clamp(10px,2.8vw,13px);color:var(--y)}
.lb-foot a{display:inline-block;margin-top:8px;color:#bdbdbd;font-size:12px}
.lb-skel{height:240px;border-radius:14px;background:linear-gradient(90deg,#ececec,#f7f7f7,#ececec);background-size:200% 100%;animation:lb-sk 1.2s linear infinite}
@keyframes lb-sk{to{background-position:-200% 0}}
`

const SHARE = '<svg viewBox="0 0 24 24"><path d="M12 15V3M7 8l5-5 5 5M5 13v6a2 2 0 002 2h10a2 2 0 002-2v-6"/></svg>'
const SEARCH = '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>'
const CUBE = '<svg viewBox="0 0 24 24"><path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M12 12l9-5M12 12L3 7M12 12v10"/></svg>'

const el = (tag, cls, html) => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (html != null) e.innerHTML = html
  return e
}
const abs = rel => new URL(rel, location.href).href

async function main() {
  lockZoom()
  const style = document.createElement('style')
  style.textContent = CSS
  document.head.appendChild(style)
  const qs = new URLSearchParams(location.search)
  const state = {q: qs.get('q') || '', tag: qs.get('tag') || ''}
  let catalog = {title: '3D & AR Model Library', models: []}

  const root = document.getElementById('app')
  root.innerHTML = ''
  const head = el('header', 'lb-head')
  const wrap = el('div', 'lb-wrap')
  const top = el('div', 'lb-top')
  const logo = el('img', 'lb-logo')
  logo.src = 'logo.png'
  logo.alt = 'M. J. Electric, LLC - A Quanta Services Company'
  logo.addEventListener('error', () => logo.remove())
  const titles = el('div', '', '<div class="lb-kick">M. J. Electric, LLC</div><h1></h1>')
  const shareLib = el('button', 'lb-share', `${SHARE}<span>Share</span>`)
  shareLib.type = 'button'
  shareLib.setAttribute('aria-label', 'Share this library')
  top.append(logo, titles, el('div', 'lb-grow'), shareLib)
  wrap.appendChild(top)
  wrap.appendChild(el('p', 'lb-sub', 'Tap a model to explore it. On your phone, models marked AR can be placed right in front of you.'))
  head.appendChild(wrap)

  const tools = el('div', 'lb-tools')
  const tw = el('div', 'lb-wrap')
  const searchBox = el('div', 'lb-search', SEARCH)
  const input = el('input')
  input.type = 'search'
  input.placeholder = 'Search models'
  input.setAttribute('aria-label', 'Search models')
  input.autocomplete = 'off'
  input.value = state.q
  searchBox.appendChild(input)
  const chips = el('div', 'lb-chips')
  chips.setAttribute('role', 'tablist')
  tw.append(searchBox, chips)
  tools.appendChild(tw)

  const main = el('main', 'lb-main')
  const count = el('p', 'lb-count')
  const grid = el('div', 'lb-grid')
  main.append(count, grid)
  const foot = el('footer', 'lb-foot', '<div class="lb-motto">INTEGRITY &bull; INSPIRED &bull; INVESTED</div><a href="licenses.html">Credits &amp; licenses</a>')
  root.append(head, tools, main, foot)
  for (let i = 0; i < 4; i++) grid.appendChild(el('div', 'lb-skel'))

  const sync = () => {
    const p = new URLSearchParams()
    if (state.q) p.set('q', state.q)
    if (state.tag) p.set('tag', state.tag)
    const s = p.toString()
    try { history.replaceState(null, '', s ? `?${s}` : location.pathname) } catch (e) { /* ignore */ }
  }

  const matches = (m) => {
    if (state.tag && !(m.tags || []).includes(state.tag)) return false
    const q = state.q.trim().toLowerCase()
    if (!q) return true
    return `${m.title} ${m.description || ''} ${(m.tags || []).join(' ')}`.toLowerCase().includes(q)
  }

  const renderChips = () => {
    const counts = new Map()
    catalog.models.forEach(m => (m.tags || []).forEach(t => counts.set(t, (counts.get(t) || 0) + 1)))
    chips.textContent = ''
    const mk = (label, tag, n) => {
      const b = el('button', 'lb-chip' + (state.tag === tag ? ' on' : ''), '')
      b.type = 'button'
      b.setAttribute('role', 'tab')
      b.setAttribute('aria-selected', state.tag === tag ? 'true' : 'false')
      b.textContent = label
      if (n != null) b.appendChild(el('small', '', String(n)))
      b.addEventListener('click', () => { state.tag = tag; sync(); render() })
      chips.appendChild(b)
    }
    mk('All', '', catalog.models.length)
    ;[...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])).forEach(([t, n]) => mk(t, t, n))
    chips.hidden = counts.size === 0
  }

  const card = (m) => {
    const c = el('article', 'lb-card')
    const a = el('a', 'lb-link')
    a.href = `view.html?m=${encodeURIComponent(m.slug)}`
    const img = el('div', 'lb-img', CUBE)
    if (m.preview) {
      const im = el('img')
      im.loading = 'lazy'
      im.alt = ''
      im.decoding = 'async'
      im.src = m.preview
      im.addEventListener('error', () => im.remove())
      img.appendChild(im)
    }
    if (m.mode === 'ar') img.appendChild(el('span', 'lb-badge', 'AR'))
    const body = el('div', 'lb-body')
    const h = el('h3')
    h.textContent = m.title
    body.appendChild(h)
    if (m.description) {
      const p = el('p')
      p.textContent = m.description
      body.appendChild(p)
    }
    if ((m.tags || []).length) {
      const tg = el('div', 'lb-tags')
      m.tags.forEach((t) => { const s = el('span', 'lb-tag'); s.textContent = t; tg.appendChild(s) })
      body.appendChild(tg)
    }
    a.append(img, body)
    const cs = el('button', 'lb-cs', SHARE)
    cs.type = 'button'
    cs.setAttribute('aria-label', `Share ${m.title}`)
    cs.addEventListener('click', () => openShareSheet({
      title: m.title,
      url: abs(a.getAttribute('href')),
      embedUrl: abs(`${a.getAttribute('href')}&embed=1`),
    }))
    c.append(a, cs)
    return c
  }

  const render = () => {
    renderChips()
    const list = catalog.models.filter(matches)
    grid.textContent = ''
    if (!catalog.models.length) {
      count.textContent = ''
      const e = el('div', 'lb-empty', '<b>No models yet</b>Models published to this library will show up here.')
      grid.style.display = 'block'
      grid.appendChild(e)
      return
    }
    grid.style.display = ''
    count.textContent = `${list.length} model${list.length === 1 ? '' : 's'}${state.tag ? ` in ${state.tag}` : ''}`
    if (!list.length) {
      const e = el('div', 'lb-empty', '<b>Nothing matches</b>Try a different word, or show all models.')
      const b = el('button', '', 'Show all models')
      b.type = 'button'
      b.addEventListener('click', () => { state.q = ''; state.tag = ''; input.value = ''; sync(); render() })
      e.appendChild(b)
      grid.style.display = 'block'
      grid.appendChild(e)
      return
    }
    list.forEach(m => grid.appendChild(card(m)))
  }

  input.addEventListener('input', () => { state.q = input.value; sync(); render() })
  shareLib.addEventListener('click', () => openShareSheet({
    title: catalog.title,
    url: abs(location.pathname.split('/').pop() === 'index.html' ? 'index.html' : './'),
    note: 'Share the whole library.',
  }))

  try {
    const res = await fetch('library.json', {cache: 'no-cache'})
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    catalog = await res.json()
    if (!Array.isArray(catalog.models)) catalog.models = []
    catalog.models = catalog.models.filter(m => m && /^[a-z0-9-]+$/.test(m.slug || ''))
  } catch (err) {
    grid.textContent = ''
    grid.style.display = 'block'
    grid.appendChild(el('div', 'lb-empty', '<b>The library could not be loaded</b>Check your connection and try again.'))
    titles.querySelector('h1').textContent = catalog.title
    return
  }
  document.title = catalog.title || '3D & AR Model Library'
  titles.querySelector('h1').textContent = catalog.title || '3D & AR Model Library'
  render()
}

main()

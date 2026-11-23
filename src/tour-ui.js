// Guided-tour controls: previous/next arrows plus a list menu. Used by the viewer and the author preview.
import {injectStyles} from './core.js'

const CHEVRON_LEFT = '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>'
const CHEVRON_RIGHT = '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>'

export function createTourUI(container, tour, {title = '', showHint = true} = {}) {
  injectStyles()
  const ui = document.createElement('div')
  ui.className = 'mk-ui'
  ui.innerHTML = '<div class="mk-title"></div>'
    + '<button class="mk-menu-btn" type="button">&#9776; Markers</button>'
    + '<div class="mk-list"><div class="mk-list-head"><span>Markers</span>'
    + '<button type="button" class="mk-list-close" aria-label="Close list">&times;</button></div>'
    + '<div class="mk-list-items"></div></div>'
    + '<div class="mk-nav">'
    + `<button class="mk-arrow mk-prev" type="button" aria-label="Previous marker">${CHEVRON_LEFT}</button>`
    + '<button class="mk-nav-label" type="button"></button>'
    + `<button class="mk-arrow mk-next" type="button" aria-label="Next marker">${CHEVRON_RIGHT}</button>`
    + '</div>'
    + '<div class="mk-hint">Tap a marker, or use the arrows to take the tour</div>'
  container.appendChild(ui)

  const q = sel => ui.querySelector(sel)
  const list = q('.mk-list')
  const items = q('.mk-list-items')
  const label = q('.mk-nav-label')
  const hint = q('.mk-hint')
  if (!showHint) hint.remove()
  q('.mk-title').textContent = title
  q('.mk-title').hidden = !title

  const setList = open => list.classList.toggle('open', open)

  const markerTitle = (m, i) => m.title || `Marker ${i + 1}`

  const renderList = () => {
    items.textContent = ''
    if (!tour.markers.length) {
      const e = document.createElement('div')
      e.className = 'mk-list-empty'
      e.textContent = 'No markers.'
      items.appendChild(e)
      return
    }
    tour.markers.forEach((m, i) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'mk-list-item' + (i === tour.selected ? ' active' : '')
      const num = document.createElement('span')
      num.className = 'mk-list-num'
      num.textContent = String(i + 1)
      const text = document.createElement('span')
      text.className = 'mk-list-text'
      text.textContent = markerTitle(m, i)
      b.append(num, text)
      b.addEventListener('click', () => {
        tour.select(i, {fly: true})
        if (window.innerWidth < 760) setList(false) // leave the message visible on small screens
      })
      items.appendChild(b)
    })
  }

  const renderLabel = () => {
    const n = tour.markers.length
    const i = tour.selected
    label.textContent = ''
    const main = document.createElement('span')
    const sub = document.createElement('small')
    if (!n) {
      main.textContent = 'No markers'
    } else if (i < 0) {
      main.textContent = `${n} marker${n === 1 ? '' : 's'}`
      sub.textContent = 'Tap an arrow to start'
    } else {
      main.textContent = markerTitle(tour.markers[i], i)
      sub.textContent = `${i + 1} of ${n}`
    }
    label.append(main, sub)
  }

  const refresh = () => {
    renderList()
    renderLabel()
    if (tour.selected >= 0) hint.style.opacity = '0'
  }

  q('.mk-prev').addEventListener('click', () => tour.prev())
  q('.mk-next').addEventListener('click', () => tour.next())
  label.addEventListener('click', () => setList(!list.classList.contains('open')))
  q('.mk-menu-btn').addEventListener('click', () => setList(!list.classList.contains('open')))
  q('.mk-list-close').addEventListener('click', () => setList(false))
  // Don't let taps on the controls fall through to the 3D view (and close the open message).
  ui.addEventListener('pointerdown', e => e.stopPropagation())
  ui.addEventListener('pointerup', e => e.stopPropagation())

  const onKey = (e) => {
    const t = e.target
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
    if (e.key === 'ArrowRight') tour.next()
    else if (e.key === 'ArrowLeft') tour.prev()
    else if (e.key === 'Escape') {
      if (list.classList.contains('open')) setList(false)
      else tour.select(-1)
    }
  }
  window.addEventListener('keydown', onKey)

  const off = tour.on(refresh)
  refresh()
  const hintTimer = setTimeout(() => { hint.style.opacity = '0' }, 6000)

  return {
    refresh,
    destroy() {
      clearTimeout(hintTimer)
      window.removeEventListener('keydown', onKey)
      off()
      ui.remove()
    },
  }
}

// The structure builder page: a toolbox of parts on the left, a live 3D structure, and a button that opens the structure in
// the grounding tool. The structure is described by a small recipe (see structure/recipe.js); every change rebuilds the 3D
// structure, saves it as a model in memory and loads that into the same viewer the library uses, so what is built here
// behaves exactly like any other model, including for grounding.
import {GLTFExporter} from 'three/examples/jsm/exporters/GLTFExporter.js'
import {createStage, injectStyles, lockZoom} from './core.js'
import {createGrounding, createGroundUI} from './grounding.js'
import {fingerprintOf} from './grounding-record.js'
import {
  buildStructure, disposeStructure, normalizeRecipe, armLetters, layoutArms, DEFAULT_RECIPE, TYPE_DEFAULTS, PRESETS, STRUCTURES,
  ARM_TYPES, INSULATORS, LIMITS, MAX_GUYS, STANDOFF_FT, FT, LINE_END_CHOICES,
} from './structure/recipe.js'

const STORE = 'mje-structure-recipe-2'
const CSS = `
.sb *{box-sizing:border-box}
.sb-panel{position:absolute;z-index:20;left:0;top:0;bottom:0;width:min(360px,100%);display:flex;flex-direction:column;background:#0b0b0b;color:#fff;
  font:14px/1.35 'Segoe UI',system-ui,Arial,sans-serif;border-right:3px solid #FFEF00;pointer-events:auto}
.sb-head{display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid #2a2a2a;flex:none}
.sb-head img{height:34px}
.sb-head b{font-size:17px;flex:1}
.sb-head small{background:#FFEF00;color:#000;font-weight:700;border-radius:999px;padding:2px 9px;font-size:11px;letter-spacing:.04em}
.sb-scroll{flex:1;overflow-y:auto;padding:4px 12px 12px}
.sb-sec{padding:12px 0 6px;border-bottom:1px solid #222}
.sb-sec h3{margin:0 0 8px;font:700 12px 'Segoe UI',system-ui,Arial,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:#FFEF00}
.sb-cards{display:flex;flex-wrap:wrap;gap:6px}
.sb-card{flex:1 1 calc(50% - 6px);min-width:110px;min-height:44px;padding:8px 10px;border:2px solid #333;border-radius:10px;background:#161616;color:#fff;
  font:600 13px 'Segoe UI',system-ui,Arial,sans-serif;text-align:left;cursor:pointer;touch-action:manipulation}
.sb-card.on{border-color:#FFEF00;background:#2a2800;color:#FFEF00}
.sb-card.soon{opacity:.45;cursor:default}
.sb-card small{display:block;font-weight:500;font-size:11px;color:#9a9a9a}
.sb-row{display:flex;align-items:center;gap:8px;margin:7px 0}
.sb-row label{flex:0 0 96px;font-size:13px;color:#ddd}
.sb-row input[type=range]{flex:1;min-width:0;accent-color:#FFEF00;height:28px}
.sb-row input[type=number]{width:70px;height:34px;border:2px solid #333;border-radius:8px;background:#161616;color:#fff;font:600 14px 'Segoe UI',system-ui,Arial,sans-serif;padding:0 6px;text-align:right}
.sb-row input[type=number]:focus{outline:0;border-color:#FFEF00}
.sb-row span{font-size:12px;color:#9a9a9a;width:16px}
.sb-check{display:flex;align-items:center;gap:10px;min-height:38px;font-size:14px;cursor:pointer}
.sb-check input{width:20px;height:20px;accent-color:#FFEF00}
.sb-note{margin:8px 0 0;padding:8px 10px;border-left:4px solid #FFEF00;background:#1d1b00;font-size:12.5px;color:#f1e96b}
.sb-soon{margin:6px 0 0;font-size:12px;color:#8a8a8a}
.sb-foot{flex:none;padding:10px 12px calc(10px + env(safe-area-inset-bottom));border-top:1px solid #2a2a2a;display:flex;flex-direction:column;gap:8px}
.sb-go{height:48px;border:0;border-radius:12px;background:#FFEF00;color:#000;font:800 15px 'Segoe UI',system-ui,Arial,sans-serif;cursor:pointer}
.sb-go:active{background:#E6D700}
.sb-small{display:flex;gap:8px}
.sb-small button{flex:1;height:38px;border:2px solid #333;border-radius:10px;background:#161616;color:#fff;font:600 13px 'Segoe UI',system-ui,Arial,sans-serif;cursor:pointer}
.sb-tiny{font-size:11px;color:#8a8a8a;text-align:center}
.sb-back{position:absolute;z-index:30;right:12px;top:calc(12px + env(safe-area-inset-top));height:44px;padding:0 16px;border:0;border-radius:12px;
  background:#000;color:#FFEF00;font:700 14px 'Segoe UI',system-ui,Arial,sans-serif;border:2px solid #FFEF00;cursor:pointer;pointer-events:auto}
.sb-panel[hidden],.sb-back[hidden]{display:none}
.sb-fold{display:none}
.sb-step{display:flex;align-items:center;gap:8px;margin:7px 0}
.sb-step label{flex:1;font-size:13px;color:#ddd}
.sb-step button{width:40px;height:36px;border:2px solid #333;border-radius:10px;background:#161616;color:#FFEF00;font:700 20px/1 'Segoe UI',system-ui,Arial,sans-serif;cursor:pointer}
.sb-step b{width:26px;text-align:center;font-size:16px}
.sb-armrow label{flex:0 0 86px;font-size:12.5px}
.sb-armrow em{font-style:normal;font-size:10.5px;color:#f1e96b;width:46px}
.sb-guy{margin:8px 0;padding:8px 10px;border:2px solid #2a2a2a;border-radius:10px}
.sb-guy h4{margin:0 0 4px;display:flex;justify-content:space-between;align-items:center;font-size:13px}
.sb-guy h4 button{height:30px;padding:0 10px;border:2px solid #333;border-radius:8px;background:#161616;color:#fff;font:600 12px 'Segoe UI',system-ui,Arial,sans-serif;cursor:pointer}
.sb-add{width:100%;min-height:40px;border:2px dashed #555;border-radius:10px;background:none;color:#FFEF00;font:700 13px 'Segoe UI',system-ui,Arial,sans-serif;cursor:pointer}
.sb-arm h4 em{font-style:normal;font-weight:500;font-size:11.5px;color:#f1e96b}
.sb-select{width:100%;height:38px;margin:4px 0;border:2px solid #333;border-radius:8px;background:#161616;color:#fff;font:600 13px 'Segoe UI',system-ui,Arial,sans-serif;padding:0 8px}
.sb-select:focus{outline:0;border-color:#FFEF00}
.sb-chips{display:flex;align-items:center;gap:6px;margin:4px 0 2px;font-size:12px;color:#9a9a9a}
.sb-chips span{margin-right:2px}
.sb-chips small{font-size:11px;margin-left:2px}
.sb-chips button{min-width:38px;height:34px;border:2px solid #333;border-radius:8px;background:#161616;color:#fff;font:700 13px 'Segoe UI',system-ui,Arial,sans-serif;cursor:pointer}
.sb-chips button.on{border-color:#FFEF00;color:#FFEF00;background:#2a2800}
.sb-sub{margin:10px 0 2px;font:700 11px 'Segoe UI',system-ui,Arial,sans-serif;color:#aaa;letter-spacing:.08em;text-transform:uppercase}
@media(max-width:700px){
  .sb-panel{top:auto;width:100%;height:min(54vh,520px);border-right:0;border-top:3px solid #FFEF00}
  .sb-panel.folded{height:auto}.sb-panel.folded .sb-scroll,.sb-panel.folded .sb-foot{display:none}
  .sb-fold{display:block;border:0;background:none;color:#FFEF00;font:700 13px 'Segoe UI',system-ui,Arial,sans-serif;cursor:pointer;padding:6px}
}
`

const cap = s => s.charAt(0).toUpperCase() + s.slice(1)
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e }

const exportGlb = group => new Promise((resolve, reject) => {
  new GLTFExporter().parse(group, resolve, reject, {binary: true})
})

function loadSaved() {
  try { return JSON.parse(localStorage.getItem(STORE) || 'null') } catch (e) { return null }
}

async function main() {
  lockZoom()
  injectStyles()
  const style = el('style'); style.textContent = CSS; document.head.appendChild(style)
  const root = document.getElementById('app')
  root.style.cssText = 'position:fixed;inset:0;overflow:hidden;background:#000'
  root.classList.add('sb')
  const stage = createStage(root, {dracoPath: 'draco/'})

  let recipe = normalizeRecipe(loadSaved() || DEFAULT_RECIPE)
  let buffer = null
  let info = {conductors: [], notes: []}
  let seq = 0
  let first = true
  let timer = 0
  let grounding = null
  let groundUI = null

  // ---- the panel ------------------------------------------------------------------------------------------
  const panel = el('div', 'sb-panel')
  panel.innerHTML = `<div class="sb-head"><img src="logo.png" alt=""><b>Structure Builder</b><small>TEST</small><button class="sb-fold" type="button">Hide</button></div>
    <div class="sb-scroll"></div>
    <div class="sb-foot"><button class="sb-go" type="button">Ground this structure &rarr;</button>
      <div class="sb-small"><button class="sb-dl" type="button">Download .glb</button><button class="sb-rj" type="button">Save recipe</button><button class="sb-reset" type="button">Reset</button></div>
      <div class="sb-tiny">Training visual. Sizes are nominal, not an engineering drawing.</div></div>`
  root.appendChild(panel)
  const scroll = panel.querySelector('.sb-scroll')

  const section = (title) => { const s = el('div', 'sb-sec', `<h3>${title}</h3>`); scroll.appendChild(s); return s }
  const cards = (sec, group, list, current, onPick) => {
    const wrap = el('div', 'sb-cards')
    list.forEach((it) => {
      const b = el('button', `sb-card${it.id === current ? ' on' : ''}${it.ready === false ? ' soon' : ''}`, `${it.label}${it.ready === false ? '<small>coming soon</small>' : ''}`)
      b.type = 'button'
      if (it.ready !== false) b.addEventListener('click', () => onPick(it.id))
      wrap.appendChild(b)
    })
    sec.appendChild(wrap)
    return wrap
  }
  let syncers = []
  // a slider and a typed number that always show the same value; get/set talk to the recipe
  const numberRow = (sec, label, unit, get, set, [min, max, step], cls = '', tag = null) => {
    const row = el('div', `sb-row ${cls}`, `<label>${label}</label><input type="range" min="${min}" max="${max}" step="${step}"><input type="number" min="${min}" max="${max}" step="${step < 1 ? step : 1}"><span>${unit}</span>${tag ? '<em></em>' : ''}`)
    const [range, num] = row.querySelectorAll('input')
    const em = row.querySelector('em')
    const sync = () => { range.value = num.value = get(); if (em) em.textContent = tag(get()) }
    range.addEventListener('input', () => { set(+range.value, true) })
    num.addEventListener('change', () => { set(+num.value, true) })
    syncers.push(sync)
    sync()
    sec.appendChild(row)
  }
  const stepper = (sec, label, get, set, [min, max]) => {
    const row = el('div', 'sb-step', `<label>${label}</label><button type="button">&minus;</button><b></b><button type="button">+</button>`)
    const [minus, plus] = row.querySelectorAll('button')
    row.querySelector('b').textContent = get()
    minus.addEventListener('click', () => get() > min && set(get() - 1))
    plus.addEventListener('click', () => get() < max && set(get() + 1))
    sec.appendChild(row)
  }
  const setArms = (side, n) => {
    const cur = recipe[side]
    const other = recipe[side === 'right' ? 'left' : 'right']
    const last = cur.length ? cur[cur.length - 1] : (other.length ? other[other.length - 1] : null)
    const fill = {len: last ? last.len : TYPE_DEFAULTS[recipe.structure].right[0], dy: 0, de: last ? last.de : false} // a new arm: same length and kind, default place
    const arr = cur.slice(0, n)
    while (arr.length < n) arr.push(fill)
    update({[side]: arr})
  }
  const setArm = (side, i, patch, soon = true) => update({[side]: recipe[side].map((x, k) => (k === i ? {...x, ...patch} : x))}, soon)
  // what the arm does with the line: through on an insulator, a dead end, or a terminal dead end
  const lineEndSelect = (current, onPick) => {
    const sel = el('select', 'sb-select', LINE_END_CHOICES.map(c => `<option value="${c.id}">${c.label}</option>`).join(''))
    if (current === null) sel.insertAdjacentHTML('afterbegin', '<option value="__mixed" disabled hidden>Mixed (set on each arm)</option>')
    sel.value = current === null ? '__mixed' : (current || '')
    sel.addEventListener('change', () => onPick(sel.value || false))
    return sel
  }
  const levelCount = () => Math.min(LIMITS.arms[1], Math.max(3, recipe.right.length, recipe.left.length))
  // one box per arm: its length, how far it is moved up or down, and quick "put it at level N" buttons
  const armBox = (sec, side, i, letter) => {
    const box = el('div', 'sb-guy sb-arm', `<h4><span>Arm ${letter} &middot; ${side}</span><em></em></h4>`)
    const em = box.querySelector('em')
    const chips = el('div', 'sb-chips', '<span>Put at level</span>')
    const buttons = []
    for (let k = 0; k < levelCount(); k++) {
      const b = el('button', '', String(k + 1))
      b.type = 'button'
      b.title = k === 0 ? 'Top arm position' : `Same height as arm number ${k + 1} on the other side`
      b.addEventListener('click', () => setArm(side, i, {dy: Math.round(((i - k) * layoutArms(recipe).spacing / FT) * 10) / 10}, false))
      chips.appendChild(b)
      buttons.push(b)
    }
    chips.appendChild(el('small', '', '1 = top'))
    const show = () => {
      const a = recipe[side][i]
      if (!a) return
      const lay = layoutArms(recipe)
      em.textContent = `${a.len < STANDOFF_FT ? 'standoff, ' : ''}at ${(lay[side][i].y / FT).toFixed(1)} ft`
      buttons.forEach((b, k) => b.classList.toggle('on', Math.abs(lay[side][i].y - lay.slot(k)) < 0.06))
    }
    syncers.push(show)
    show()
    box.appendChild(lineEndSelect(recipe[side][i].de, v => setArm(side, i, {de: v}, false)))
    numberRow(box, 'Length', 'ft', () => recipe[side][i].len, v => setArm(side, i, {len: v}), LIMITS.armLength)
    numberRow(box, 'Up / down', 'ft', () => recipe[side][i].dy, v => setArm(side, i, {dy: v}), LIMITS.armShift)
    box.appendChild(chips)
    sec.appendChild(box)
  }
  const setGuy = (i, patch) => update({guys: recipe.guys.map((g, k) => (k === i ? {...g, ...patch} : g))}, true)

  const render = () => {
    const keepScroll = scroll.scrollTop
    scroll.innerHTML = ''
    syncers = []
    const lattice = recipe.structure === 'lattice'
    let n = 0
    const sec = title => section(`${++n} &middot; ${title}`)
    let s = sec('Structure type')
    cards(s, 'structure', STRUCTURES, recipe.structure, id => update({structure: id, ...TYPE_DEFAULTS[id], guys: [], topPhase: false}))
    s = sec('Arm type')
    cards(s, 'arm', ARM_TYPES, ARM_TYPES.find(a => a.for === recipe.structure).id, () => {})
    s = sec('Arms')
    s.appendChild(el('div', 'sb-sub', 'Quick layouts'))
    cards(s, 'preset', PRESETS[recipe.structure].map((p, i) => ({id: String(i), label: p.label})), '', (id) => {
      const p = PRESETS[recipe.structure][+id]
      update({right: p.right, left: p.left, topPhase: p.topPhase})
    })
    s.appendChild(el('div', 'sb-sub', 'How many arms'))
    stepper(s, 'Right side', () => recipe.right.length, n => setArms('right', n), LIMITS.arms)
    stepper(s, 'Left side', () => recipe.left.length, n => setArms('left', n), LIMITS.arms)
    const letters = armLetters(recipe)
    if (recipe.right.length + recipe.left.length > 1) {
      s.appendChild(el('div', 'sb-sub', 'Length of every arm'))
      numberRow(s, 'All arms', 'ft', () => (recipe.right.length ? recipe.right[0].len : recipe.left[0].len), v => update({right: recipe.right.map(a => ({...a, len: v})), left: recipe.left.map(a => ({...a, len: v}))}, true), LIMITS.armLength)
    }
    const allArms = [...recipe.right, ...recipe.left]
    if (allArms.length) {
      s.appendChild(el('div', 'sb-sub', 'Line end'))
      const same = allArms.every(a => a.de === allArms[0].de) ? allArms[0].de : null
      const all = lineEndSelect(same, v => update({right: recipe.right.map(a => ({...a, de: v})), left: recipe.left.map(a => ({...a, de: v}))}))
      all.title = 'Every arm'
      s.appendChild(el('div', 'sb-soon', 'Every arm:'))
      s.appendChild(all)
      s.appendChild(el('div', 'sb-soon', 'A dead end holds the wire on a strain string. With the line on both sides, a jumper hangs down between the two strings. A terminal dead end has the line on one side only (front is the side of the down ground) and the wire is left as a tail hanging down on the structure side. Either way it is one wire, one phase. The strings use the bell count under Insulators.'))
    }
    if (allArms.length) s.appendChild(el('div', 'sb-sub', 'Each arm (the arm letter is its wire)'))
    recipe.right.forEach((_, i) => armBox(s, 'right', i, letters.right[i]))
    recipe.left.forEach((_, i) => armBox(s, 'left', i, letters.left[i]))
    if (recipe.right.some(a => a.dy) || recipe.left.some(a => a.dy)) {
      const reset = el('button', 'sb-add', 'Put every arm back at its default height')
      reset.type = 'button'
      reset.addEventListener('click', () => update({right: recipe.right.map(a => ({...a, dy: 0})), left: recipe.left.map(a => ({...a, dy: 0}))}))
      s.appendChild(reset)
    }
    s.appendChild(el('div', 'sb-soon', `Up / down moves one arm from its default place (+ up, &minus; down), for example a lone arm on the left that belongs at the middle or lower level. Under ${STANDOFF_FT * 12} in an arm becomes a standoff: the insulator is mounted straight on the ${lattice ? 'tower' : 'pole'}.`))
    if (!lattice) {
      s = sec('Pole-top phase')
      const row = el('label', 'sb-check', '<input type="checkbox"><span>Phase on top of the pole</span>')
      row.firstChild.checked = recipe.topPhase
      row.firstChild.addEventListener('change', e => update({topPhase: e.target.checked}))
      s.appendChild(row)
      if (recipe.topPhase) {
        const top = recipe.topInsulator
        cards(s, 'topins', [{id: 'pin', label: 'Pole-top pin insulator'}, {id: 'suspension', label: 'Suspension string on a bracket'}], top.type, id => update({topInsulator: {...top, type: id}}))
        const topType = INSULATORS.find(t => t.id === top.type)
        cards(s, 'topmat', topType.materials.map(m => ({id: m, label: cap(m)})), top.material, m => update({topInsulator: {...top, material: m}})).style.marginTop = '8px'
        s.appendChild(el('div', 'sb-soon', `This is wire ${letters.top}. It is a real phase, separate from the static (shield) wire in Details, and the two can be used together. A string uses the bell count under Insulators.`))
      }
    }
    s = sec('Size')
    numberRow(s, lattice ? 'Tower height' : 'Pole height', 'ft', () => recipe.height, v => update({height: v}, true), LIMITS.height)
    if (recipe.right.length > 1 || recipe.left.length > 1) numberRow(s, 'Arm spacing', 'ft', () => recipe.armSpacing, v => update({armSpacing: v}, true), LIMITS.armSpacing)
    s = sec('Insulators on the arms')
    cards(s, 'ins', INSULATORS, recipe.insulator.type, id => update({insulator: {...recipe.insulator, type: id}}))
    const type = INSULATORS.find(t => t.id === recipe.insulator.type)
    cards(s, 'mat', type.materials.map(m => ({id: m, label: cap(m)})), recipe.insulator.material, m => update({insulator: {...recipe.insulator, material: m}})).style.marginTop = '8px'
    if (type.bells || allArms.some(a => a.de)) numberRow(s, 'Bells', '', () => recipe.insulator.bells, v => update({insulator: {...recipe.insulator, bells: v}}, true), LIMITS.bells)
    s = sec('Details')
    const checks = [['staticWire', 'Static (shield) wire']]
    if (!lattice) checks.unshift(['downGround', 'Down ground (pole ground)'])
    checks.forEach(([k, label]) => {
      const row = el('label', 'sb-check', `<input type="checkbox"><span>${label}</span>`)
      const box = row.firstChild
      box.checked = !!recipe.details[k]
      box.addEventListener('change', () => update({details: {...recipe.details, [k]: box.checked}}))
      s.appendChild(row)
    })
    if (!lattice) {
      s.appendChild(el('div', 'sb-sub', 'Guy wires'))
      recipe.guys.forEach((g, i) => {
        const box = el('div', 'sb-guy', `<h4><span>Guy ${i + 1}</span><button type="button">Remove</button></h4>`)
        box.querySelector('button').addEventListener('click', () => update({guys: recipe.guys.filter((_, k) => k !== i)}))
        numberRow(box, 'Direction', '&deg;', () => recipe.guys[i].angle, v => setGuy(i, {angle: v}), LIMITS.guyAngle)
        numberRow(box, 'Anchor out', 'ft', () => recipe.guys[i].reach, v => setGuy(i, {reach: v}), LIMITS.guyReach)
        numberRow(box, 'Attached at', 'ft', () => recipe.guys[i].attach, v => setGuy(i, {attach: v}), LIMITS.guyAttach)
        s.appendChild(box)
      })
      if (recipe.guys.length < MAX_GUYS) {
        const add = el('button', 'sb-add', '+ Add a guy wire and anchor')
        add.type = 'button'
        add.addEventListener('click', () => update({guys: [...recipe.guys, {angle: [180, 90, 270, 0][recipe.guys.length], reach: 25, attach: Math.min(30, recipe.height - 3)}]}))
        s.appendChild(add)
      }
      s.appendChild(el('div', 'sb-soon', 'Direction: 0&deg; runs along the line on the side of the down ground, 90&deg; toward the right arms, 180&deg; the other way along the line, 270&deg; toward the left arms.'))
    }
    s.appendChild(el('div', 'sb-soon', 'More on the way: dead-end hardware, arrestors, switches, transformers and more.'))
    const notes = el('div'); notes.className = 'sb-notes'; scroll.appendChild(notes)
    showNotes()
    scroll.scrollTop = keepScroll
  }
  const showNotes = () => {
    const box = scroll.querySelector('.sb-notes')
    if (box) box.innerHTML = info.notes.map(n => `<div class="sb-note">${n}</div>`).join('')
  }

  // ---- rebuilding -------------------------------------------------------------------------------------------
  const rebuild = async () => {
    const mine = ++seq
    const built = buildStructure(recipe)
    const buf = await exportGlb(built.group)
    info = built.info
    disposeStructure(built)
    if (mine !== seq) return
    const pos = stage.camera.position.clone()
    const target = stage.controls.target.clone()
    buffer = buf
    await stage.loadModel(buf)
    if (!first) { stage.camera.position.copy(pos); stage.controls.target.copy(target); stage.controls.update() }
    first = false
    showNotes()
  }
  const update = (patch, soon = false) => {
    recipe = normalizeRecipe({...recipe, ...patch})
    try { localStorage.setItem(STORE, JSON.stringify(recipe)) } catch (e) { /* not saved, still works */ }
    clearTimeout(timer)
    timer = setTimeout(rebuild, soon ? 90 : 0)
    if (!soon) render(); else syncers.forEach(f => f())
  }

  // ---- ground mode ------------------------------------------------------------------------------------------
  const back = el('button', 'sb-back', '&larr; Back to builder')
  back.type = 'button'
  back.hidden = true
  root.appendChild(back)
  const enterGround = () => {
    if (grounding || !buffer) return
    panel.hidden = true
    back.hidden = false
    grounding = createGrounding(stage, {model: {slug: 'built-structure', title: 'Built structure', bytes: buffer.byteLength, fingerprint: fingerprintOf(buffer)}})
    grounding.attach(root)
    groundUI = createGroundUI(root, grounding, {tour: null, shiftForLibraryBar: false})
    groundUI.setOn(true)
  }
  const leaveGround = () => {
    if (!grounding) return
    groundUI.destroy()
    grounding.destroy()
    grounding = null
    groundUI = null
    panel.hidden = false
    back.hidden = true
  }
  back.addEventListener('click', leaveGround)
  panel.querySelector('.sb-go').addEventListener('click', enterGround)

  const download = (name, blob) => {
    const a = el('a'); a.href = URL.createObjectURL(blob); a.download = name
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 4000)
  }
  panel.querySelector('.sb-dl').addEventListener('click', () => buffer && download('built-structure.glb', new Blob([buffer], {type: 'model/gltf-binary'})))
  panel.querySelector('.sb-rj').addEventListener('click', () => download('structure-recipe.json', new Blob([JSON.stringify(recipe, null, 2)], {type: 'application/json'})))
  panel.querySelector('.sb-reset').addEventListener('click', () => update(DEFAULT_RECIPE))
  panel.querySelector('.sb-fold').addEventListener('click', (e) => {
    panel.classList.toggle('folded')
    e.target.textContent = panel.classList.contains('folded') ? 'Show' : 'Hide'
  })

  render()
  await rebuild()
  window.__sb = {stage, update, enterGround, leaveGround, get recipe() { return recipe }, get info() { return info }, get grounding() { return grounding }, rebuild}
}

main()

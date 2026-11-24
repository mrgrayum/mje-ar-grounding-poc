// A structure is described by a small "recipe" (plain data: which parts, how big). buildStructure(recipe) turns a recipe
// into the 3D structure out of the parts in parts.js. The same recipe always gives the same structure, so a recipe can be
// saved, sent and rebuilt anywhere (the library, the AR page, the authoring app).
//
// All sizes in a recipe are in FEET (what the crews use). The 3D parts work in meters; buildStructure converts.
//
//   {
//     v: 2, structure: 'single-pole' | 'lattice', height,           feet, ground to the top of the pole or tower body
//     armSpacing,                                                    feet between arms (grows if an insulator needs more room)
//     right: [{len, dy, de}, ...], left: [...],                      one entry per arm, 0 to 6 arms per side. de: false, or a dead end
//                                                                    ('both' | 'front' | 'back', see LINE_ENDS). len: feet of arm
//                                                                    (a plain number also works). dy: feet to move the arm up (+)
//                                                                    or down (-) from its default place; arm number i starts i
//                                                                    spacings below the top, the same on both sides.
//     topPhase, topInsulator: {type, material},                      one more phase on top of a wood pole, on its own pin or string
//     insulator: {type, material, bells},                            what the arms carry
//     details: {downGround, staticWire},
//     guys: [{angle, reach, attach}],                                degrees around the pole, feet out, feet up the pole
//   }
//
// Each arm carries one wire. The wire letters run: top phase first (if any), then the right arms top to bottom, then the left
// arms top to bottom. Arm "C" holds "PhaseC_Conductor" and "InsulatorC", so the names always line up.
import * as THREE from 'three'
import {
  makeMaterials, makePole, makeSideArm, makeStandoffBracket, makeTrussArm, makeLatticeTower, makeInsulatorString, makePinInsulator,
  makeConductor, makeDownGround, makeStaticWire, makeGuy, poleRadiusAt, stringLength, MAX_BELLS, PIN_HEIGHT,
  makeDeadEndString, makeDeadEndConductor, deadEndDip, DEADEND_DROP,
} from './parts.js'

export const FT = 0.3048
export const STANDOFF_FT = 0.5 // an arm shorter than this is a standoff: the insulator is mounted straight on the pole or tower

// What each choice in the toolbox means. "ready: false" ones are shown in the builder as coming next.
export const STRUCTURES = [
  {id: 'single-pole', label: 'Single wood pole', ready: true},
  {id: 'lattice', label: 'Lattice tower', ready: true},
  {id: 'h-frame', label: 'H-frame', ready: false},
  {id: 'three-pole', label: 'Three-pole', ready: false},
  {id: 'monopole', label: 'Steel monopole', ready: false},
]
export const ARM_TYPES = [
  {id: 'wood-arm', label: 'Wood arm', ready: true, for: 'single-pole'},
  {id: 'truss-arm', label: 'Steel truss arm', ready: true, for: 'lattice'},
  {id: 'davit', label: 'Davit arm', ready: false},
  {id: 'post', label: 'Post-style arm', ready: false},
]
// Insulators: a type, and the materials that type comes in. Suspension strings are chosen by their number of bells.
export const INSULATORS = [
  {id: 'suspension', label: 'Suspension string', materials: ['glass', 'polymer'], bells: true, ready: true},
  {id: 'pin', label: 'Pin insulator', materials: ['porcelain', 'polymer'], bells: false, ready: true},
  {id: 'post', label: 'Post insulator', materials: [], bells: false, ready: false},
]
// Starting points: what a structure type begins with, and one-tap layouts.
export const TYPE_DEFAULTS = {
  'single-pole': {height: 45, armSpacing: 5, right: [6.5, 6.5, 6.5], left: [], topPhase: false},
  lattice: {height: 90, armSpacing: 12, right: [12, 12, 12], left: [12, 12, 12], topPhase: false},
}
export const PRESETS = {
  'single-pole': [
    {label: 'One crossarm, 3 phases', right: [5], left: [5], topPhase: true},
    {label: '3 arms, one side', right: [6.5, 6.5, 6.5], left: [], topPhase: false},
    {label: '3 arms each side', right: [6.5, 6.5, 6.5], left: [6.5, 6.5, 6.5], topPhase: false},
  ],
  lattice: [
    {label: '3 arms each side (double circuit)', right: [12, 12, 12], left: [12, 12, 12], topPhase: false},
    {label: '1 arm each side', right: [14], left: [14], topPhase: false},
    {label: '3 arms, one side', right: [12, 12, 12], left: [], topPhase: false},
  ],
}
export const LIMITS = {
  height: [20, 110, 1], // feet: min, max, step
  armLength: [0, 15, 0.5],
  armSpacing: [3, 15, 0.5],
  bells: [1, MAX_BELLS, 1],
  arms: [0, 6, 1],
  armShift: [-60, 60, 0.5], // feet an arm may be moved up or down from its default place
  guyAngle: [0, 355, 5],
  guyReach: [5, 100, 1],
  guyAttach: [5, 100, 1],
}
export const MAX_GUYS = 4
// What an arm does with the line. false: the wire runs through on an insulator. A dead end holds the wire on strain strings:
// 'both' the line goes on both sides and a jumper joins them; 'front' / 'back' a terminal dead end, the line comes in from
// that side only (front is the +Z side, the side of the down ground on a pole).
export const LINE_ENDS = ['both', 'front', 'back']
export const LINE_END_CHOICES = [
  {id: '', label: 'Through (on an insulator)'},
  {id: 'both', label: 'Dead end, line on both sides'},
  {id: 'front', label: 'Terminal dead end, line on the front'},
  {id: 'back', label: 'Terminal dead end, line on the back'},
]

export const DEFAULT_RECIPE = {
  v: 2,
  structure: 'single-pole',
  height: 45,
  armSpacing: 5,
  right: [6.5, 6.5, 6.5],
  left: [],
  topPhase: false,
  topInsulator: {type: 'pin', material: 'porcelain'},
  insulator: {type: 'suspension', material: 'glass', bells: 4},
  details: {downGround: true, staticWire: false},
  guys: [],
}

const clampTo = ([lo, hi], v, fallback) => Math.min(hi, Math.max(lo, Number.isFinite(+v) ? +v : fallback))

function normalizeInsulator(i = {}) {
  const type = INSULATORS.find(t => t.id === i.type && t.ready) || INSULATORS[0]
  const material = type.materials.includes(i.material) ? i.material : type.materials[0]
  return {type: type.id, material, bells: Math.round(clampTo(LIMITS.bells, i.bells, DEFAULT_RECIPE.insulator.bells))}
}
// the top-of-pole phase carries a pin insulator or a hanging string
function normalizeTopInsulator(i) {
  const n = normalizeInsulator(i && i.type ? i : {type: 'pin'})
  return {type: n.type, material: n.material}
}
// an arm is {len, dy}; a plain number means a length with no up/down move
const arm = (v) => {
  const o = v && typeof v === 'object' ? v : {len: v}
  return {len: Math.round(clampTo(LIMITS.armLength, o.len, 6.5) * 4) / 4, dy: Math.round(clampTo(LIMITS.armShift, o.dy, 0) * 10) / 10, de: LINE_ENDS.includes(o.de) ? o.de : (o.de === true ? 'both' : false)}
}
const arms = (list, fallback) => (Array.isArray(list) ? list : fallback).slice(0, LIMITS.arms[1]).map(arm)

// Fills in anything missing and keeps every number inside what the parts can handle. A recipe from before version 2 starts over.
export function normalizeRecipe(r) {
  if (!r || r.v !== 2) r = DEFAULT_RECIPE
  const structure = STRUCTURES.find(s => s.id === r.structure && s.ready) ? r.structure : 'single-pole'
  const base = TYPE_DEFAULTS[structure]
  const pole = structure === 'single-pole'
  return {
    v: 2,
    structure,
    height: Math.round(clampTo(LIMITS.height, r.height, base.height)),
    armSpacing: clampTo(LIMITS.armSpacing, r.armSpacing, base.armSpacing),
    right: arms(r.right, base.right),
    left: arms(r.left, base.left),
    topPhase: pole && !!r.topPhase,
    topInsulator: normalizeTopInsulator(r.topInsulator),
    insulator: normalizeInsulator(r.insulator),
    details: {
      downGround: pole && !(r.details && r.details.downGround === false),
      staticWire: !!(r.details && r.details.staticWire),
    },
    guys: pole && Array.isArray(r.guys)
      ? r.guys.slice(0, MAX_GUYS).map(g => ({
        angle: Math.round(clampTo(LIMITS.guyAngle, g.angle, 180)),
        reach: Math.round(clampTo(LIMITS.guyReach, g.reach, 25)),
        attach: Math.round(clampTo(LIMITS.guyAttach, g.attach, 30)),
      }))
      : [],
  }
}

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M']

// The wire letter of every arm: {top, right: [...], left: [...]}.
export function armLetters(recipe) {
  let n = 0
  const take = () => LETTERS[n++]
  const top = recipe.topPhase ? take() : null
  const right = recipe.right.map(take)
  const left = recipe.left.map(take)
  return {top, right, left}
}

// Where every arm sits, in meters up from the ground. Arm number i starts i spacings below the top (the same on both sides),
// then its own up/down move is added. Also used by the panel to show "at 38.5 ft" next to each arm.
export function layoutArms(recipeIn) {
  const recipe = normalizeRecipe(recipeIn)
  const lattice = recipe.structure === 'lattice'
  const H = recipe.height * FT
  const susp = recipe.insulator.type === 'suspension'
  const len = stringLength(recipe.insulator.bells)
  const toTop = lattice ? 2.4 : 0.7
  const wanted = recipe.armSpacing * FT
  let need = susp ? len + 0.4 : PIN_HEIGHT + 0.5 // the insulator must clear the arm below (hanging) or above (standing)
  if ([...recipe.right, ...recipe.left].some(a => a.de)) need = Math.max(need, deadEndDip(recipe.insulator.bells) + 0.4) // the jumper hangs down
  const spacing = Math.max(wanted, need)
  const hi = H - toTop
  const place = (a, i) => {
    const lo = Math.min(hi, 0.6 + (a.de ? Math.max(DEADEND_DROP, 1.3 * deadEndDip(recipe.insulator.bells)) : susp ? len : 0)) // keep the wire off the ground
    const raw = hi - i * spacing + a.dy * FT
    const y = Math.min(hi, Math.max(lo, raw))
    return {y, clamped: Math.abs(y - raw) > 1e-6}
  }
  return {spacing, wanted, need, slot: k => hi - k * spacing, right: recipe.right.map(place), left: recipe.left.map(place)}
}

// Returns {group, mats, recipe, info}. info: the wires (name, letter, height), notes for the user, the lowest wire height.
export function buildStructure(recipeIn) {
  const recipe = normalizeRecipe(recipeIn)
  const lattice = recipe.structure === 'lattice'
  const H = recipe.height * FT
  const mats = makeMaterials()
  const group = new THREE.Group()
  group.name = 'Structure'
  const notes = []
  const conductors = []
  const ins = recipe.insulator
  const bells = ins.bells
  const susp = ins.type === 'suspension'
  const len = stringLength(bells)
  const letters = armLetters(recipe)

  // the body: where the arms attach
  let sideAt
  let pole = null
  if (lattice) {
    const tower = makeLatticeTower(mats, {height: H})
    tower.meshes.forEach(m => group.add(m))
    sideAt = tower.sideAt
  } else {
    pole = {height: H, rBase: 0.2 + Math.max(0, H - 12) * 0.012, rTop: 0.14 + Math.max(0, H - 12) * 0.004}
    group.add(makePole(mats, pole))
    sideAt = y => poleRadiusAt(pole, y)
  }

  // hang below an arm (suspension) or stand on top of it (pin)
  const seat = (armTop, armBottom) => (susp
    ? {insY: armBottom, condY: armBottom - len + 0.1}
    : {insY: armTop, condY: armTop + PIN_HEIGHT + 0.03})

  const phases = [] // {letter, x, z, insY, condY, side, susp?, kind?}
  const nArms = Math.max(recipe.right.length, recipe.left.length)
  const lay = layoutArms(recipe)
  if (nArms > 1 && lay.spacing > lay.wanted + 1e-6) notes.push(`Arm spacing was increased to ${(lay.spacing / FT).toFixed(1)} ft so the insulators clear the next arm.`)

  // dead-end strings are strain strings: glass or polymer, with the bell count from the Insulators section
  const deadKind = ins.type === 'suspension' ? ins.material : (ins.material === 'polymer' ? 'polymer' : 'glass')
  const addArm = (side, i, a, letter) => {
    const {y, clamped} = lay[side === 1 ? 'right' : 'left'][i]
    let lengthFt = a.len
    if (a.de && lengthFt < 1.5) {
      lengthFt = 1.5
      notes.push(`Arm ${letter} is a dead end, so it is drawn at least 1.5 ft long to carry the strings.`)
    }
    if (clamped) notes.push(`Arm ${letter} was held at ${(y / FT).toFixed(1)} ft: that is as far up or down as it can go on this structure.`)
    const root = sideAt(y)
    const L = lengthFt * FT
    const name = `Crossarm_${letter}`
    if (lengthFt < STANDOFF_FT) {
      notes.push(`Arm ${letter} is a standoff (shorter than ${STANDOFF_FT * 12} in): the insulator is mounted straight on the ${lattice ? 'tower' : 'pole'}.`)
      if (susp) {
        const b = makeStandoffBracket(mats, {name, side, y, rootX: root})
        group.add(b)
        phases.push({letter, x: b.userData.endX - side * 0.05, z: 0, ...seat(b.userData.top, y - 0.05)})
      } else {
        const x0 = side * root * 0.97
        phases.push({letter, x: x0, z: 0, insY: y, condY: y, side, lying: true, condX: x0 + side * (PIN_HEIGHT + 0.03)})
      }
      return
    }
    const arm = lattice
      ? makeTrussArm(mats, {name, side, y, rootX: root, length: L})
      : makeSideArm(mats, {name, side, y, rootX: root, length: L})
    group.add(arm)
    if (a.de) {
      phases.push({letter, x: arm.userData.endX - side * 0.1, z: 0, yA: y, deadEnd: a.de})
      return
    }
    const inset = Math.min(0.25, L * 0.4)
    phases.push({letter, x: arm.userData.endX - side * inset, z: 0, ...seat(arm.userData.top, lattice ? y - 0.02 : y - 0.08)})
  }
  recipe.right.forEach((a, i) => addArm(1, i, a, letters.right[i]))
  recipe.left.forEach((a, i) => addArm(-1, i, a, letters.left[i]))

  // two arms on one side must leave room for the insulator between them
  const crowded = (side, list, names) => {
    const order = list.map((p, i) => ({y: p.y, n: names[i]})).sort((a, b) => b.y - a.y)
    for (let k = 1; k < order.length; k++) {
      const gap = order[k - 1].y - order[k].y
      if (gap < 0.15) notes.push(`Arms ${order[k - 1].n} and ${order[k].n} are at the same height on the ${side}. Move one up or down.`)
      else if (gap < lay.need - 0.05) notes.push(`Arms ${order[k - 1].n} and ${order[k].n} on the ${side} are only ${(gap / FT).toFixed(1)} ft apart: the insulator may touch the next arm.`)
    }
  }
  crowded('right', lay.right, letters.right)
  crowded('left', lay.left, letters.left)

  // a phase on top of a wood pole: a pole-top pin insulator, or a string hung from a short bracket
  const top = recipe.topInsulator
  const topSusp = top.type === 'suspension'
  if (recipe.topPhase) {
    const r = sideAt(H)
    if (topSusp) {
      const y = H - 0.15
      const stub = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.45).translate(0, y, r + 0.2), mats.steel)
      stub.name = 'TopBracket'
      group.add(stub)
      phases.push({letter: letters.top, x: 0, z: r + 0.4, insY: y - 0.035, condY: y - 0.035 - len + 0.1, susp: true, kind: top.material})
    } else {
      phases.push({letter: letters.top, x: 0, z: 0, insY: H, condY: H + PIN_HEIGHT + 0.03, susp: false, kind: top.material})
    }
  }

  phases.forEach((p) => {
    if (p.deadEnd) {
      // two strain strings along the line, one wire (both spans and the jumper) named for the phase
      if (p.deadEnd !== 'back') group.add(makeDeadEndString(mats, {name: `Insulator${p.letter}_Front`, x: p.x, y: p.yA, side: 1, bells, kind: deadKind}))
      if (p.deadEnd !== 'front') group.add(makeDeadEndString(mats, {name: `Insulator${p.letter}_Back`, x: p.x, y: p.yA, side: -1, bells, kind: deadKind}))
      const name = `Phase${p.letter}_Conductor`
      group.add(makeDeadEndConductor(mats, {name, x: p.x, y: p.yA, bells, ends: p.deadEnd}))
      conductors.push({name, letter: p.letter, x: p.x, y: p.yA - Math.max(DEADEND_DROP, 1.3 * deadEndDip(bells))})
      return
    }
    const insName = `Insulator${p.letter}`
    const isSusp = p.susp !== undefined ? p.susp : susp
    const kind = p.kind || ins.material
    group.add(isSusp
      ? makeInsulatorString(mats, {name: insName, x: p.x, y: p.insY, z: p.z, bells, kind})
      : makePinInsulator(mats, {name: insName, x: p.x, y: p.insY, z: p.z, kind, side: p.lying ? p.side : 0}))
    const name = `Phase${p.letter}_Conductor`
    const cx = p.condX !== undefined ? p.condX : p.x
    const c = makeConductor(mats, {name, x: cx, y: p.condY})
    c.position.z = p.z
    group.add(c)
    conductors.push({name, letter: p.letter, x: cx, y: p.condY})
  })

  const lowestWire = conductors.length ? Math.min(...conductors.map(c => c.y)) - 0.35 : H
  if (conductors.length && lowestWire < 3) notes.push('This structure is too short for these arms: the lowest wire is below 10 ft. Raise the height or reduce the spacing.')
  if (!conductors.length) notes.push('No arms yet. Add arms on the right or the left.')

  if (recipe.details.downGround && pole) group.add(...makeDownGround(mats, pole, {topY: H - 0.6}))
  if (recipe.details.staticWire) {
    const mastHeight = recipe.topPhase && !topSusp ? 1.3 : 0.9 // taller when a pin insulator carries the top phase
    const [mast, wire] = makeStaticWire(mats, {height: H}, {mastHeight})
    group.add(mast, wire)
    conductors.push({name: 'Static_Conductor', letter: 'S', x: 0, y: H + mastHeight + 0.04})
  }
  recipe.guys.forEach((g, i) => {
    const attachY = Math.min(g.attach * FT, H - 0.6)
    group.add(...makeGuy(mats, pole, {index: i + 1, angle: g.angle, attachY, reach: g.reach * FT}))
  })

  group.updateMatrixWorld(true)
  return {group, mats, recipe, info: {conductors, notes, lowestWire}}
}

export function disposeStructure(built) {
  built.group.traverse((o) => { if (o.geometry) o.geometry.dispose() })
  Object.values(built.mats).forEach(m => m.dispose())
}

// A structure is described by a small "recipe" (plain data: which parts, how big). buildStructure(recipe) turns a recipe
// into the 3D structure out of the parts in parts.js. The same recipe always gives the same structure, so a recipe can be
// saved, sent and rebuilt anywhere (the library, the AR page, the authoring app).
import * as THREE from 'three'
import {
  makeMaterials, makePole, makeSideArm, makeCrossarm, makeInsulatorString, makePinInsulator, makeConductor, makeDownGround,
  makeStaticWire, makeGuy, poleRadiusAt, stringLength, MAX_BELLS, PIN_HEIGHT,
} from './parts.js'

// What each choice in the toolbox means. "ready: false" ones are shown in the builder as coming next.
export const STRUCTURES = [
  {id: 'single-pole', label: 'Single wood pole', ready: true},
  {id: 'h-frame', label: 'H-frame', ready: false},
  {id: 'three-pole', label: 'Three-pole', ready: false},
  {id: 'lattice', label: 'Lattice tower', ready: false},
  {id: 'monopole', label: 'Steel monopole', ready: false},
]
export const ARM_TYPES = [
  {id: 'wood-arm', label: 'Wood arm', ready: true},
  {id: 'davit', label: 'Davit arm', ready: false},
  {id: 'post', label: 'Post-style arm', ready: false},
]
// armLength is how far an arm reaches out of the pole (a crossarm: each way from the pole).
// Insulators: a type, and the materials that type comes in. Suspension strings are chosen by their number of bells.
export const INSULATORS = [
  {id: 'suspension', label: 'Suspension string', materials: ['glass', 'polymer'], bells: true, ready: true},
  {id: 'pin', label: 'Pin insulator', materials: ['porcelain', 'polymer'], bells: false, ready: true},
  {id: 'post', label: 'Post insulator', materials: [], bells: false, ready: false},
]
export const LAYOUTS = [
  {id: 'crossarm', label: 'One crossarm, 3 phases', armLength: 1.5, ready: true},
  {id: 'vertical-one', label: '3 arms, one side', armLength: 2.0, ready: true},
  {id: 'vertical-both', label: '3 arms each side (2 circuits)', armLength: 2.0, ready: true},
]
export const LIMITS = {
  height: [8, 30, 0.5], // min, max, step (m)
  armLength: [0.8, 5, 0.1],
  armSpacing: [1, 3, 0.1],
  bells: [1, MAX_BELLS, 1],
}

export const DEFAULT_RECIPE = {
  structure: 'single-pole',
  armType: 'wood-arm',
  layout: 'vertical-one',
  height: 14,
  armLength: 2.0,
  armSpacing: 1.5,
  insulator: {type: 'suspension', material: 'glass', bells: 4},
  details: {downGround: true, staticWire: false, guyWire: false},
}

const clampTo = ([lo, hi], v, fallback) => Math.min(hi, Math.max(lo, Number.isFinite(+v) ? +v : fallback))

function normalizeInsulator(i = {}) {
  const type = INSULATORS.find(t => t.id === i.type && t.ready) || INSULATORS[0]
  const material = type.materials.includes(i.material) ? i.material : type.materials[0]
  return {type: type.id, material, bells: Math.round(clampTo(LIMITS.bells, i.bells, DEFAULT_RECIPE.insulator.bells))}
}

// Fills in anything missing and keeps every number inside what the parts can handle.
export function normalizeRecipe(r = {}) {
  const d = DEFAULT_RECIPE
  const layout = LAYOUTS.find(l => l.id === r.layout) || LAYOUTS.find(l => l.id === d.layout)
  return {
    structure: 'single-pole',
    armType: 'wood-arm',
    layout: layout.id,
    height: clampTo(LIMITS.height, r.height, d.height),
    armLength: clampTo(LIMITS.armLength, r.armLength, layout.armLength),
    armSpacing: clampTo(LIMITS.armSpacing, r.armSpacing, d.armSpacing),
    insulator: normalizeInsulator(r.insulator),
    details: {
      downGround: !(r.details && r.details.downGround === false),
      staticWire: !!(r.details && r.details.staticWire),
      guyWire: !!(r.details && r.details.guyWire),
    },
  }
}

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F']

// Returns {group, mats, info}. info: the conductors (name and phase letter), notes for the user and the lowest wire height.
export function buildStructure(recipeIn) {
  const recipe = normalizeRecipe(recipeIn)
  const H = recipe.height
  const pole = {height: H, rBase: 0.2 + Math.max(0, H - 12) * 0.008, rTop: 0.14}
  const mats = makeMaterials()
  const group = new THREE.Group()
  group.name = 'Structure'
  const notes = []
  const conductors = []
  const ins = recipe.insulator
  const bells = ins.bells
  const susp = ins.type === 'suspension'
  const len = stringLength(bells)
  // hang below an arm (suspension) or stand on top of it (pin); returns where the insulator starts and the wire sits
  const seat = (armTop, armBottom) => (susp
    ? {insY: armBottom - 0.0, condY: armBottom - len + 0.1}
    : {insY: armTop, condY: armTop + PIN_HEIGHT + 0.03})

  group.add(makePole(mats, pole))

  // Where every phase goes: {letter, x, z, insY, condY}
  const phases = []
  let lowestArmY = H
  if (recipe.layout === 'crossarm') {
    const y = H - 1.2
    const reach = recipe.armLength
    const arm = makeCrossarm(mats, {name: 'Crossarm1', y, reach})
    group.add(arm)
    const armTop = arm.userData.top
    const armBottom = y - 0.08
    const inset = 0.25
    const side = seat(armTop, armBottom)
    phases.push({letter: 'A', x: -(reach - inset), z: 0, ...side}, {letter: 'C', x: reach - inset, z: 0, ...side})
    if (susp) {
      // a suspension string cannot hang inside the pole, so the middle phase hangs in front of it on a short bracket
      const zf = poleRadiusAt(pole, y) + 0.4
      const stub = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.45).translate(0, armBottom, poleRadiusAt(pole, y) + 0.2), mats.steel)
      stub.name = 'ArmStub'
      group.add(stub)
      phases.push({letter: 'B', x: 0, z: zf, insY: armBottom - 0.035, condY: armBottom - 0.035 - len + 0.1})
    } else {
      phases.push({letter: 'B', x: 0, z: 0, insY: H, condY: H + PIN_HEIGHT + 0.03}) // a pin insulator on top of the pole
    }
    lowestArmY = y
  } else {
    const sides = recipe.layout === 'vertical-both' ? [1, -1] : [1]
    const wanted = recipe.armSpacing
    const need = susp ? len + 0.4 : PIN_HEIGHT + 0.5 // the insulator must clear the arm below (hanging) or above (standing)
    const spacing = Math.max(wanted, need)
    if (spacing > wanted + 1e-6) notes.push(`Arm spacing was increased to ${spacing.toFixed(1)} m so the insulators clear the next arm.`)
    const top = H - 0.7
    for (let i = 0; i < 3; i++) {
      const y = top - i * spacing
      lowestArmY = y
      sides.forEach((side, si) => {
        const arm = makeSideArm(mats, pole, {name: `Crossarm_${side > 0 ? 'R' : 'L'}${i + 1}`, side, y, length: recipe.armLength})
        group.add(arm)
        phases.push({letter: LETTERS[si * 3 + i], x: arm.userData.endX - side * 0.25, z: 0, ...seat(arm.userData.top, y - 0.08)})
      })
    }
  }

  phases.forEach((p) => {
    const insName = `Insulator${p.letter}`
    group.add(susp
      ? makeInsulatorString(mats, {name: insName, x: p.x, y: p.insY, z: p.z, bells, kind: ins.material})
      : makePinInsulator(mats, {name: insName, x: p.x, y: p.insY, z: p.z, kind: ins.material}))
    const name = `Phase${p.letter}_Conductor`
    const c = makeConductor(mats, {name, x: p.x, y: p.condY})
    c.position.z = p.z
    group.add(c)
    conductors.push({name, letter: p.letter, x: p.x, y: p.condY})
  })

  const lowestWire = Math.min(...conductors.map(c => c.y)) - 0.35
  if (lowestArmY < 3 || lowestWire < 3) notes.push('This pole is too short for this layout: the lowest wire is below 3 m. Raise the pole height.')

  if (recipe.details.downGround) group.add(...makeDownGround(mats, pole, {topY: H - 0.6}))
  if (recipe.details.staticWire) {
    const mastHeight = recipe.layout === 'crossarm' && !susp ? 1.3 : 0.9 // taller when a pin insulator carries the middle phase
    const [mast, wire] = makeStaticWire(mats, pole, {mastHeight})
    group.add(mast, wire)
    conductors.push({name: 'Static_Conductor', letter: 'S', x: 0, y: H + mastHeight + 0.04})
  }
  if (recipe.details.guyWire) {
    const attachY = Math.max(3, Math.min(H * 0.6, lowestArmY - 1))
    group.add(...makeGuy(mats, pole, {attachY, reach: attachY * 0.6}))
  }

  group.updateMatrixWorld(true)
  return {group, mats, recipe, info: {conductors, notes, lowestWire}}
}

export function disposeStructure(built) {
  built.group.traverse((o) => { if (o.geometry) o.geometry.dispose() })
  Object.values(built.mats).forEach(m => m.dispose())
}

// How the model appears when it is placed in AR. Four styles to choose from (add &intro=<style> to the address of the AR page):
//   grow      the model grows out of the spot that was tapped, with a small overshoot and settle
//   drop      the model falls from above, lands with a bounce and a ring of dust spreads over the floor
//   scan      a glowing yellow ring sweeps up the model from the floor and the model exists only below it
//   assemble  the parts fly in one after another (lowest first), popping into place
//   off       no animation
// Every style also sends a yellow ripple across the floor from the tapped spot. It plays when the model is placed (and again
// after "Move model"), takes about a second, and puts every transform and material back exactly as it was when it is done.
import * as THREE from 'three'

export const INTRO_KINDS = ['off', 'grow', 'drop', 'scan', 'assemble']

const clamp01 = x => Math.min(1, Math.max(0, x))
const easeOutCubic = t => 1 - (1 - t) ** 3
const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
const easeOutBack = (t, k = 1.4) => 1 + (k + 1) * (t - 1) ** 3 + k * (t - 1) ** 2

// anchor: where the model stands (position, turn, size chosen by the user). group: between the anchor and the model, so the
// animation never fights the user's own turning and resizing. frame: the model's own space. renderer: for clipping (scan).
// setHidden(on): hides or shows what grounding has drawn on the model.
export function createIntro({anchor, group, frame, renderer, kind = 'grow', setHidden = () => {}}) {
  const style = INTRO_KINDS.includes(kind) ? kind : 'grow'
  let model = null // {root, box, size, longest}
  let run = null // what is playing now
  const ripples = []

  const rippleMat = () => new THREE.MeshBasicMaterial({color: 0xFFEF00, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide})
  const ringGeo = new THREE.RingGeometry(0.88, 1, 72).rotateX(-Math.PI / 2)

  const addRipple = (radius, delay = 0, duration = 0.9, color = 0xFFEF00) => {
    const m = new THREE.Mesh(ringGeo, rippleMat())
    m.material.color.setHex(color)
    m.userData.noPick = true
    m.renderOrder = 997
    m.position.y = model.longest * 0.003
    m.scale.setScalar(0.001)
    m.visible = false
    anchor.add(m)
    ripples.push({m, t: -delay, duration, radius})
  }
  const footprint = () => Math.min(Math.max(Math.max(model.size.x, model.size.z) * 0.6, model.longest * 0.12), model.longest * 0.7)

  const finish = () => {
    if (!run) return
    group.position.set(0, 0, 0)
    group.scale.set(1, 1, 1)
    if (run.kind === 'scan') {
      run.materials.forEach((mt) => { mt.clippingPlanes = null; mt.needsUpdate = true })
      frame.remove(run.ring)
      run.ring.geometry.dispose()
      run.ring.material.dispose()
    }
    if (run.kind === 'assemble') {
      run.parts.forEach((p) => {
        p.o.position.copy(p.basePos)
        p.o.scale.copy(p.baseScale)
        p.o.visible = p.baseVisible
      })
      setHidden(false)
    }
    run = null
  }

  const init = {
    grow() {
      group.scale.setScalar(0.001)
      addRipple(footprint() * 1.1)
      return {dur: 1.0}
    },
    drop() {
      const startY = model.longest * 1.1
      group.position.y = startY
      return {dur: 1.4, startY, landed: false}
    },
    scan() {
      const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0)
      const materials = new Set()
      frame.traverse((o) => {
        if (!(o.isMesh || o.isInstancedMesh) || o.userData.fxIgnore) return
        ;(Array.isArray(o.material) ? o.material : [o.material]).forEach(mt => materials.add(mt))
      })
      materials.forEach((mt) => { mt.clippingPlanes = [plane]; mt.needsUpdate = true })
      if (renderer) renderer.localClippingEnabled = true
      const R = footprint()
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(R, Math.max(model.longest * 0.006, 0.004), 8, 96).rotateX(Math.PI / 2),
        new THREE.MeshBasicMaterial({color: 0xFFEF00, transparent: true, opacity: 0.95})
      )
      ring.userData.noPick = true
      ring.userData.fxIgnore = true
      ring.renderOrder = 996
      frame.add(ring)
      addRipple(R * 1.2)
      return {dur: 1.7, plane, materials, ring}
    },
    assemble() {
      anchor.updateWorldMatrix(true, true)
      const sc = anchor.getWorldScale(new THREE.Vector3()).x || 1
      const q = anchor.getWorldQuaternion(new THREE.Quaternion())
      const parts = []
      model.root.traverse((o) => {
        if (!o.isMesh || o.userData.noPick) return
        const box = new THREE.Box3().setFromObject(o)
        if (box.isEmpty()) return
        const centerW = box.getCenter(new THREE.Vector3())
        const heightMU = (box.max.y - box.min.y) / sc
        const tall = heightMU > model.size.y * 0.55 // a pole or a leg: grows up out of the floor instead of flying in
        const pivotW = tall ? new THREE.Vector3(centerW.x, box.min.y, centerW.z) : centerW
        const parent = o.parent
        const pivot = parent.worldToLocal(pivotW.clone())
        const centerMU = frame.worldToLocal(centerW.clone())
        parts.push({o, parent, pivot, tall, y: centerMU.y, basePos: o.position.clone(), baseScale: o.scale.clone(), baseVisible: o.visible, off: new THREE.Vector3(), delay: 0})
      })
      parts.sort((a, b) => a.y - b.y)
      parts.forEach((p, i) => {
        p.delay = parts.length > 1 ? (i / (parts.length - 1)) * 1.0 : 0
        const r1 = ((i * 7919) % 100) / 100
        const r2 = ((i * 104729) % 100) / 100
        if (!p.tall) {
          // from above and a little to one side, in model units, then expressed in the part's parent's own units
          const worldOff = new THREE.Vector3((r1 - 0.5) * model.longest * 0.5, model.longest * (0.25 + 0.3 * r2), (r2 - 0.5) * model.longest * 0.5)
            .applyQuaternion(q).multiplyScalar(sc)
          const from = p.parent.localToWorld(p.basePos.clone())
          p.off.copy(p.parent.worldToLocal(from.add(worldOff))).sub(p.basePos)
        }
        p.o.visible = false
      })
      setHidden(true)
      addRipple(footprint() * 1.1)
      return {dur: 1.0 + 0.7, parts, partDur: 0.7}
    },
  }

  return {
    get kind() { return style },
    get running() { return !!run },
    setModel(m) { model = m },
    // Starts the animation (call right after the model has been placed and made visible).
    play() {
      finish()
      if (style === 'off' || !model) return
      anchor.updateWorldMatrix(true, true)
      run = {kind: style, t: 0, ...init[style]()}
    },
    // Stops at once and leaves the model complete (for "Move model" while it is still playing).
    cancel() { finish() },
    update(dt) {
      for (let i = ripples.length - 1; i >= 0; i--) {
        const r = ripples[i]
        r.t += dt
        if (r.t < 0) continue
        const p = clamp01(r.t / r.duration)
        r.m.visible = p < 1
        r.m.scale.setScalar(Math.max(r.radius * easeOutCubic(p), 0.001))
        r.m.material.opacity = 0.9 * (1 - p) ** 1.5
        if (p >= 1) { anchor.remove(r.m); r.m.material.dispose(); ripples.splice(i, 1) }
      }
      if (!run) return
      run.t += Math.min(dt, 0.1)
      const t = run.t
      const p = clamp01(t / run.dur)
      if (run.kind === 'grow') {
        group.scale.setScalar(Math.max(easeOutBack(p ** 1.4, 1.1), 0.001)) // eases in, overshoots a little, settles
      } else if (run.kind === 'drop') {
        // fall (accelerating) for 0.55 s, then a small bounce and a squash that settles
        const fall = 0.55
        if (t < fall) {
          const u = t / fall
          group.position.y = run.startY * (1 - u * u)
        } else {
          if (!run.landed) { run.landed = true; addRipple(footprint() * 1.3, 0, 0.8, 0xE8E8E8) }
          const u = clamp01((t - fall) / (run.dur - fall))
          const bounce = Math.abs(Math.sin(u * Math.PI * 2.2)) * (1 - u) ** 2 * model.longest * 0.05
          group.position.y = bounce
          const squash = Math.sin(u * Math.PI * 3.2) * (1 - u) ** 2 * 0.07
          group.scale.set(1 + squash, 1 - squash, 1 + squash)
        }
      } else if (run.kind === 'scan') {
        const h = easeInOut(clamp01(t / 1.45)) * (model.size.y * 1.01)
        run.plane.constant = anchor.position.y + h * anchor.scale.x
        run.ring.position.y = model.box.min.y + h
        run.ring.material.opacity = t > 1.45 ? Math.max(0, 1 - (t - 1.45) / 0.25) : 0.95
      } else if (run.kind === 'assemble') {
        run.parts.forEach((pt) => {
          const q = clamp01((t - pt.delay) / run.partDur)
          if (q <= 0) return
          pt.o.visible = pt.baseVisible
          const e = easeOutBack(q, 1.2)
          const s = 0.04 + 0.96 * e
          // scale the part about its pivot (its middle, or the foot of a tall part) and bring it in from its start offset
          pt.o.scale.copy(pt.baseScale).multiplyScalar(s)
          pt.o.position.copy(pt.pivot).addScaledVector(pt.basePos.clone().sub(pt.pivot), s).addScaledVector(pt.off, 1 - e)
        })
      }
      if (t >= run.dur) finish()
    },
  }
}

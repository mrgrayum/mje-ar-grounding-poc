// Calms the small shake in the AR view when the phone is held still.
//
// The phone's tracking reports the camera position and direction with tiny errors (a millimetre or two, a fraction of a
// degree) that change every frame. The model is fixed in the room, so those errors show up as the model trembling. This
// filter (a "One Euro" filter) averages them out: the slower the phone moves, the more it smooths; as soon as the phone
// really moves or turns, it lets the real movement through with almost no delay.
//
// It only touches the camera pose that our own code uses for drawing and tapping; the AR engine itself is not changed.
import * as THREE from 'three'

// posMin / rotMin: cutoff in Hz when still (lower = steadier but slower to follow). posBeta / rotBeta: how fast the cutoff
// rises with speed (higher = follows real movement sooner). posFloor (m/s) and rotFloor (rad/s): speeds below this count as
// "holding still", which is the hand tremor and tracking noise rather than real movement. dCut: how quickly the speed
// estimate follows (Hz). deadPos (m) and deadRot (rad): a "hold still zone": the drawn view stays exactly where it is until the
// smoothed pose has moved further than this away, then it follows (so tiny wobble never reaches the screen, but a real drift
// or movement does). The numbers were tuned against simulated tracking noise.
export const SMOOTH_PRESETS = {
  off: null,
  light: {posMin: 1.2, posBeta: 50, posFloor: 0.02, rotMin: 1.2, rotBeta: 50, rotFloor: 0.02, dCut: 2},
  normal: {posMin: 0.6, posBeta: 50, posFloor: 0.02, rotMin: 0.6, rotBeta: 50, rotFloor: 0.02, dCut: 2},
  strong: {posMin: 0.3, posBeta: 40, posFloor: 0.03, rotMin: 0.3, rotBeta: 40, rotFloor: 0.03, dCut: 2, deadPos: 0.002, deadRot: 0.0014},
  max: {posMin: 0.15, posBeta: 40, posFloor: 0.03, rotMin: 0.15, rotBeta: 40, rotFloor: 0.03, dCut: 2, deadPos: 0.004, deadRot: 0.0026},
}

const D_CUTOFF = 1.0 // how quickly the speed estimate itself is smoothed (Hz)
const alphaFor = (cutoff, dt) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt))

// A pose jump (the engine re-found its position, or "Move model" recentered the world) is not shake: start again from it.
const JUMP_DIST = 0.5 // metres between two frames
const JUMP_ANGLE = 0.6 // radians between two frames

export function createPoseSmoother(presetName = 'strong') {
  // a name from SMOOTH_PRESETS, or (for tuning tests) a settings object
  const custom = typeof presetName === 'object' && presetName !== null
  if (custom) presetName = 'custom'
  const preset = custom ? arguments[0] : (SMOOTH_PRESETS[presetName] === undefined ? SMOOTH_PRESETS.strong : SMOOTH_PRESETS[presetName])
  if (!SMOOTH_PRESETS[presetName] && !custom && presetName !== 'off') presetName = 'strong'
  const fp = new THREE.Vector3()
  const fq = new THREE.Quaternion()
  const lp = new THREE.Vector3()
  const lq = new THREE.Quaternion()
  const hp = new THREE.Vector3() // what is drawn (the smoothed pose, held inside the hold-still zone)
  const hq = new THREE.Quaternion()
  const rawP = new THREE.Vector3()
  const rawQ = new THREE.Quaternion()
  let speedP = 0
  let speedR = 0
  let has = false

  return {
    get name() { return presetName },
    get active() { return !!preset },
    reset() { has = false },
    // Replaces the camera's position and rotation with the smoothed ones. dt in seconds. Returns the raw pose too.
    apply(cam, dt) {
      rawP.copy(cam.position)
      rawQ.copy(cam.quaternion)
      if (!preset) return {rawP, rawQ}
      const step = Math.min(Math.max(dt, 1 / 120), 0.1)
      if (has && (rawP.distanceTo(lp) > JUMP_DIST || rawQ.angleTo(lq) > JUMP_ANGLE)) has = false
      if (!has) {
        fp.copy(rawP); fq.copy(rawQ); lp.copy(rawP); lq.copy(rawQ); hp.copy(rawP); hq.copy(rawQ)
        speedP = 0; speedR = 0
        has = true
        return {rawP, rawQ}
      }
      const aD = alphaFor(preset.dCut || D_CUTOFF, step)
      speedP += (rawP.distanceTo(lp) / step - speedP) * aD
      speedR += (rawQ.angleTo(lq) / step - speedR) * aD
      const cutP = preset.posMin + preset.posBeta * Math.max(0, speedP - preset.posFloor)
      const cutR = preset.rotMin + preset.rotBeta * Math.max(0, speedR - preset.rotFloor)
      fp.lerp(rawP, alphaFor(cutP, step))
      fq.slerp(rawQ, alphaFor(cutR, step))
      lp.copy(rawP)
      lq.copy(rawQ)
      // hold-still zone: the drawn pose only moves once the smoothed pose has left a small zone around it, and then just
      // enough to keep the smoothed pose at the edge of the zone
      const dp = fp.distanceTo(hp)
      if (dp > (preset.deadPos || 0)) hp.lerp(fp, 1 - (preset.deadPos || 0) / dp)
      const dr = fq.angleTo(hq)
      if (dr > (preset.deadRot || 0)) hq.slerp(fq, 1 - (preset.deadRot || 0) / dr)
      cam.position.copy(hp)
      cam.quaternion.copy(hq)
      return {rawP, rawQ}
    },
  }
}

// ---- the optional shake meter (add &meter=1 to the address) -----------------------------------------------------
// Shows frames per second and how much the camera shakes: the size of the frame-to-frame wobble over the last second, as
// reported by the phone ("raw") and as used for drawing ("shown"). Hold the phone still to compare smoothing settings.
export function createShakeMeter(parent, smoother) {
  const box = document.createElement('div')
  box.style.cssText = 'position:fixed;left:8px;bottom:calc(8px + env(safe-area-inset-bottom));z-index:99998;pointer-events:none;'
    + 'background:rgba(0,0,0,.72);color:#9f9;font:11px/1.35 monospace;padding:5px 8px;border-radius:8px;white-space:pre'
  parent.appendChild(box)
  const N = 45
  const raw = []
  const shown = []
  const stamps = []
  let lastShow = 0

  const wobble = (list, key) => {
    // average position and, per frame, the distance from it; for rotation, the angle from the newest frame's neighbours
    if (list.length < 8) return 0
    if (key === 'p') {
      const mean = new THREE.Vector3()
      list.forEach(p => mean.add(p))
      mean.multiplyScalar(1 / list.length)
      return Math.sqrt(list.reduce((s, p) => s + p.distanceToSquared(mean), 0) / list.length)
    }
    let s = 0
    for (let i = 1; i < list.length; i++) s += list[i].angleTo(list[i - 1]) ** 2
    return Math.sqrt(s / (list.length - 1))
  }

  return {
    // call once per frame after smoother.apply(): rawPose = what apply returned, cam = the camera after smoothing
    sample(rawPose, cam, now) {
      raw.push({p: rawPose.rawP.clone(), q: rawPose.rawQ.clone()})
      shown.push({p: cam.position.clone(), q: cam.quaternion.clone()})
      stamps.push(now)
      while (raw.length > N) { raw.shift(); shown.shift(); stamps.shift() }
      if (now - lastShow < 500) return
      lastShow = now
      const span = (stamps[stamps.length - 1] - stamps[0]) / 1000
      const fps = span > 0 ? (stamps.length - 1) / span : 0
      const rp = wobble(raw.map(x => x.p), 'p') * 1000
      const sp = wobble(shown.map(x => x.p), 'p') * 1000
      const rr = (wobble(raw.map(x => x.q), 'q') * 180) / Math.PI
      const sr = (wobble(shown.map(x => x.q), 'q') * 180) / Math.PI
      box.textContent = `${fps.toFixed(0)} fps   smoothing: ${smoother.name}\n`
        + `position wobble  raw ${rp.toFixed(1)} mm -> shown ${sp.toFixed(1)} mm\n`
        + `turn wobble      raw ${rr.toFixed(2)} deg -> shown ${sr.toFixed(2)} deg`
    },
  }
}

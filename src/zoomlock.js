// Stops the whole page from zooming (pinch, double-tap, ctrl+wheel) so the buttons and overlays can never
// end up scaled or misplaced. Pinching the model itself still works: it is handled by pointer events.
// Several layers because iOS Safari ignores the viewport tag's user-scalable setting.
let zoomLocked = false
export function lockZoom() {
  if (zoomLocked) return
  zoomLocked = true
  const css = document.createElement('style')
  css.textContent = 'html,body{touch-action:pan-x pan-y;-webkit-text-size-adjust:100%;text-size-adjust:100%;'
    + 'overscroll-behavior:none;-webkit-touch-callout:none}'
  document.head.appendChild(css)
  const stop = e => e.preventDefault()
  ;['gesturestart', 'gesturechange', 'gestureend'].forEach(t => document.addEventListener(t, stop, {passive: false}))
  document.addEventListener('dblclick', stop)
  document.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault() }, {passive: false})
  document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault() }, {passive: false})
}

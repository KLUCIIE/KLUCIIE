const BLOCKED_COMBO_KEYS = new Set(['I', 'J', 'C', 'K', 'U'])

/**
 * Anti-DevTools deterrent (production only):
 *  - blocks F12 / Ctrl|Cmd+Shift+{I,J,C,K} / Ctrl|Cmd+Alt+U / view-source and
 *    the right-click context menu;
 *  - polls for an open DevTools dock (window size delta) and for a live
 *    `debugger` pause; when detected, hides the entire app behind a full-screen
 *    shield until the tools are closed.
 *
 * This is a deterrent against casual inspection, not real security — anything
 * shipped to the browser can ultimately be extracted by a determined user.
 */
export function installDevtoolsGuard() {
  if (!import.meta.env.PROD) return

  const root = document.getElementById('root')
  const overlay = document.createElement('div')
  overlay.textContent = 'Developer tools are disabled on this site. Close them to continue.'
  overlay.setAttribute(
    'style',
    [
      'position:fixed',
      'inset:0',
      'z-index:2147483647',
      'display:none',
      'align-items:center',
      'justify-content:center',
      'background:#0f172a',
      'color:#f8fafc',
      'font-family:system-ui,-apple-system,sans-serif',
      'font-size:17px',
      'font-weight:600',
      'text-align:center',
      'padding:24px',
    ].join(';'),
  )
  document.body.appendChild(overlay)

  let open = false
  const setOpen = (v: boolean) => {
    if (v === open) return
    open = v
    overlay.style.display = v ? 'flex' : 'none'
    if (root) root.style.visibility = v ? 'hidden' : ''
  }

  window.addEventListener('contextmenu', (e) => e.preventDefault(), true)

  window.addEventListener(
    'keydown',
    (e) => {
      // Some keydown events (IME composition, media keys, synthetic events)
      // arrive without a `key` — guard before uppercasing.
      const rawKey = e.key
      if (rawKey === null || rawKey === undefined) return
      const key = String(rawKey).toUpperCase()
      if (!key) return
      if (key === 'F12') {
        e.preventDefault()
        e.stopPropagation()
        return
      }
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      if ((e.shiftKey || e.altKey) && BLOCKED_COMBO_KEYS.has(key)) {
        e.preventDefault()
        e.stopPropagation()
        return
      }
      if (!e.shiftKey && !e.altKey && key === 'U') {
        e.preventDefault()
        e.stopPropagation()
      }
    },
    true,
  )

  const SIZE_THRESHOLD = 170
  const sizeCheck = () =>
    window.outerWidth - window.innerWidth > SIZE_THRESHOLD ||
    window.outerHeight - window.innerHeight > SIZE_THRESHOLD

  const tick = () => {
    const start = performance.now()
    // eslint-disable-next-line no-debugger
    debugger
    const paused = performance.now() - start > 100
    setOpen(paused || sizeCheck())
  }

  tick()
  window.setInterval(tick, 1500)
}

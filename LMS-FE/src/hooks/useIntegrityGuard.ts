import { useCallback, useEffect, useRef, useState } from 'react'
import { studentApi } from '@/services/studentApi'

/** Tab-switch / fullscreen monitoring for an active test session.
 *  Mirrors the original integrity.js: hidden tab or window blur = a warning. */
export function useIntegrityGuard(sessionId: string | null) {
  const [warnings, setWarnings] = useState(0)
  const [flagged, setFlagged] = useState(false)
  const [showWarning, setShowWarning] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(() => !!document.fullscreenElement)
  const lastWarnAt = useRef(0)

  const log = useCallback((type: string) => {
    if (!sessionId) return
    studentApi.logIntegrity(sessionId, type).then((r) => setFlagged(r.flagged)).catch(() => {})
  }, [sessionId])

  useEffect(() => {
    if (!sessionId) return
    // blur and visibilitychange both fire on a tab switch — count it once
    const warn = (type: string) => {
      const now = Date.now()
      if (now - lastWarnAt.current < 800) { log(type); return }
      lastWarnAt.current = now
      setWarnings((w) => w + 1)
      setShowWarning(true)
      log(type)
    }
    const onVisibility = () => (document.hidden ? warn('visibility_hidden') : log('visibility_visible'))
    const onBlur = () => warn('blur')
    const onFullscreen = () => {
      const fs = !!document.fullscreenElement
      setIsFullscreen(fs)
      if (!fs) log('exit_fullscreen')
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', onBlur)
    document.addEventListener('fullscreenchange', onFullscreen)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('fullscreenchange', onFullscreen)
    }
  }, [sessionId, log])

  const enterFullscreen = useCallback(() => {
    document.documentElement.requestFullscreen?.().catch(() => {})
  }, [])

  return { warnings, flagged, showWarning, dismissWarning: () => setShowWarning(false), isFullscreen, enterFullscreen }
}

export function exitFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
}

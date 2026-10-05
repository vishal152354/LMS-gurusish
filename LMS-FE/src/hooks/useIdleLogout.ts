import { useEffect, useState } from 'react'
import { useIdleTimer } from 'react-idle-timer'
import { env } from '@/lib/env'

const WARN_MS = 60_000

/** Signs the professor out after a period of inactivity, with a 60-second
 *  warning first. Returns the countdown state for the warning dialog. */
export function useIdleLogout(enabled: boolean, onLogout: () => void) {
  const [warning, setWarning] = useState(false)
  const [remaining, setRemaining] = useState(WARN_MS / 1000)

  const timer = useIdleTimer({
    disabled: !enabled,
    timeout: env.idleTimeoutMinutes * 60_000,
    promptBeforeIdle: WARN_MS,
    throttle: 500,
    crossTab: true,
    onPrompt: () => setWarning(true),
    onIdle: () => { setWarning(false); onLogout() },
    onActive: () => setWarning(false),
  })

  // count down once per second while the warning is showing
  const { getRemainingTime } = timer
  useEffect(() => {
    if (!warning) return
    const tick = () => setRemaining(Math.max(0, Math.ceil(getRemainingTime() / 1000)))
    tick()
    const t = window.setInterval(tick, 1000)
    return () => window.clearInterval(t)
  }, [warning, getRemainingTime])

  return { warning, remaining, stayActive: () => { timer.activate(); setWarning(false) } }
}

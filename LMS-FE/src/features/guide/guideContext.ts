import { createContext, useContext, useEffect } from 'react'
import type { Mood } from './Elephant'

export interface GuideApi {
  /** Start a page tour (once per tour unless `force`). */
  startTour: (id: string, force?: boolean) => void
  /** A short message from Ellie that disappears on its own. */
  say: (text: string, mood?: Mood, ms?: number) => void
  /** The tour the help button replays on this page. */
  setPageTour: (id: string | null) => void
  touring: boolean
}

export const GuideContext = createContext<GuideApi | null>(null)

export function useGuide(): GuideApi {
  const ctx = useContext(GuideContext)
  if (!ctx) throw new Error('useGuide must be used inside <GuideProvider>')
  return ctx
}

/** Register a page's tour and auto-start it the first time (when `ready`). */
export function useTour(id: string, ready = true) {
  const { startTour, setPageTour } = useGuide()
  useEffect(() => {
    setPageTour(id)
    return () => setPageTour(null)
  }, [id, setPageTour])
  useEffect(() => {
    if (!ready) return
    const t = window.setTimeout(() => startTour(id), 650)   // let the page settle first
    return () => window.clearTimeout(t)
  }, [id, ready, startTour])
}

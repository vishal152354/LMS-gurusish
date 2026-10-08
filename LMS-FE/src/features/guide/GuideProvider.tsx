import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { BellOff, Bell, Compass, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { useAppDispatch, useAppSelector } from '@/store'
import { guideToggled, toursReset, tourSeen } from '@/store/guideSlice'
import { Elephant, type Mood } from './Elephant'
import { GuideContext, type GuideApi } from './guideContext'
import { TOURS, type TourStep } from './tours'

const CARD_W = 340
const GAP = 14
const PAD = 8

type Rect = { top: number; left: number; width: number; height: number }

function targetEl(step?: TourStep) {
  return step?.target ? document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`) : null
}

export function GuideProvider({ children }: { children: ReactNode }) {
  const dispatch = useAppDispatch()
  const { enabled, seen } = useAppSelector((s) => s.guide)
  const [tour, setTour] = useState<{ id: string; steps: TourStep[]; i: number } | null>(null)
  const [pageTour, setPageTourState] = useState<string | null>(null)
  const [bubble, setBubble] = useState<{ text: string; mood: Mood; key: number } | null>(null)
  const bubbleTimer = useRef<number>(0)
  const seenRef = useRef(seen)
  seenRef.current = seen
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled

  const startTour = useCallback((id: string, force = false) => {
    if (!force && (!enabledRef.current || seenRef.current[id])) return
    // keep only steps whose target is on screen (or that need none)
    const steps = (TOURS[id] ?? []).filter((s) => !s.target || targetEl(s))
    if (!steps.length) return
    setBubble(null)
    setTour({ id, steps, i: 0 })
  }, [])

  const say = useCallback((text: string, mood: Mood = 'talk', ms = 2600) => {
    if (!enabledRef.current) return
    window.clearTimeout(bubbleTimer.current)
    setBubble({ text, mood, key: Date.now() })
    bubbleTimer.current = window.setTimeout(() => setBubble(null), ms)
  }, [])

  const setPageTour = useCallback((id: string | null) => setPageTourState(id), [])

  const end = useCallback(() => {
    setTour((t) => { if (t) dispatch(tourSeen(t.id)); return null })
  }, [dispatch])

  const api = useMemo<GuideApi>(() => ({ startTour, say, setPageTour, touring: !!tour }), [startTour, say, setPageTour, tour])

  return (
    <GuideContext.Provider value={api}>
      {children}
      {tour && <TourOverlay tour={tour} setTour={setTour} onEnd={end} />}
      {!tour && bubble && createPortal(
        <div className="pointer-events-none fixed bottom-20 right-4 z-[60] flex items-end gap-2 sm:right-6" role="status" aria-live="polite" key={bubble.key}>
          <div className="ellie-pop mb-10 max-w-60 rounded-2xl rounded-br-sm border border-border-strong bg-popover px-4 py-2.5 text-sm font-medium shadow-xl">{bubble.text}</div>
          <Elephant mood={bubble.mood} size={84} className="ellie-pop drop-shadow-xl" />
        </div>,
        document.body,
      )}
      {createPortal(
        <HelpButton
          enabled={enabled}
          canTour={!!pageTour && !!TOURS[pageTour]}
          onTour={() => pageTour && startTour(pageTour, true)}
          onToggle={() => dispatch(guideToggled(!enabled))}
          onReset={() => dispatch(toursReset())}
        />,
        document.body,
      )}
    </GuideContext.Provider>
  )
}

function HelpButton({ enabled, canTour, onTour, onToggle, onReset }: {
  enabled: boolean; canTour: boolean; onTour: () => void; onToggle: () => void; onReset: () => void
}) {
  return (
    <div className="fixed bottom-4 right-4 z-40 sm:bottom-6 sm:right-6">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button aria-label="Ask Ellie, your guide"
            className={cn('flex size-14 items-center justify-center rounded-full border border-border-strong bg-popover shadow-xl transition-transform hover:scale-105 cursor-pointer', !enabled && 'opacity-60')}>
            <Elephant size={46} mood="idle" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" className="w-60">
          <DropdownMenuLabel>Ellie, your guide</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!canTour} onSelect={onTour}><Compass />Show me around this page</DropdownMenuItem>
          <DropdownMenuItem onSelect={onReset}><RotateCcw />Replay all tours</DropdownMenuItem>
          <DropdownMenuItem onSelect={onToggle}>{enabled ? <><BellOff />Turn Ellie off</> : <><Bell />Turn Ellie on</>}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function TourOverlay({ tour, setTour, onEnd }: {
  tour: { id: string; steps: TourStep[]; i: number }
  setTour: React.Dispatch<React.SetStateAction<{ id: string; steps: TourStep[]; i: number } | null>>
  onEnd: () => void
}) {
  const step = tour.steps[tour.i]
  const last = tour.i === tour.steps.length - 1
  const [rect, setRect] = useState<Rect | null>(null)
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight })
  const nextBtn = useRef<HTMLButtonElement>(null)

  const go = useCallback((d: number) => {
    setTour((t) => (t ? { ...t, i: Math.max(0, Math.min(t.steps.length - 1, t.i + d)) } : t))
  }, [setTour])

  // follow the highlighted element (scrolling, resizing, layout shifts)
  useLayoutEffect(() => {
    const el = targetEl(step)
    if (!el) { setRect(null); return }
    el.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    let raf = 0
    const measure = () => {
      const r = el.getBoundingClientRect()
      setRect((p) => (p && Math.abs(p.top - r.top) < 0.5 && Math.abs(p.left - r.left) < 0.5 && p.width === r.width && p.height === r.height)
        ? p : { top: r.top, left: r.left, width: r.width, height: r.height })
      setVp((v) => (v.w === window.innerWidth && v.h === window.innerHeight ? v : { w: window.innerWidth, h: window.innerHeight }))
      raf = requestAnimationFrame(measure)
    }
    measure()
    return () => cancelAnimationFrame(raf)
  }, [step])

  useEffect(() => { nextBtn.current?.focus({ preventScroll: true }) }, [tour.i])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onEnd() }
      else if (e.key === 'ArrowRight') { e.preventDefault(); if (last) onEnd(); else go(1) }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1) }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [go, last, onEnd])

  // place the card (Ellie + speech) beside the target: below if there's room, else above
  const small = vp.w < 640
  const cardW = Math.min(CARD_W, vp.w - 32)
  const cardH = 230
  let top: number, left: number
  if (!rect || small) {
    top = vp.h - cardH - 16
    left = (vp.w - cardW) / 2
  } else {
    const below = rect.top + rect.height + PAD + GAP
    top = below + cardH < vp.h ? below : Math.max(16, rect.top - PAD - GAP - cardH)
    left = Math.min(Math.max(16, rect.left + rect.width / 2 - cardW / 2), vp.w - cardW - 16)
  }

  return createPortal(
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-labelledby="ellie-title" aria-describedby="ellie-text">
      {/* dim + spotlight */}
      {rect ? (
        <div className="pointer-events-none fixed rounded-xl ring-2 ring-accent transition-all duration-500 ease-out"
          style={{ top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2, boxShadow: '0 0 0 9999px rgb(5 6 8 / 0.62)' }} />
      ) : (
        <div className="fixed inset-0 bg-[rgb(5_6_8/0.62)] transition-opacity" />
      )}
      {/* Ellie walks to each step */}
      <div className="fixed transition-[top,left] duration-500 ease-[cubic-bezier(.3,1.25,.5,1)]" style={{ top, left, width: cardW }}>
        <div className="flex items-end gap-1">
          <Elephant key={`${tour.id}-${tour.i}`} mood={last ? 'cheer' : 'talk'} size={92} className="ellie-pop -mb-1 shrink-0 drop-shadow-xl" />
          <div className="ellie-pop flex-1 rounded-2xl rounded-bl-sm border border-border-strong bg-popover p-4 shadow-2xl" key={`b-${tour.i}`}>
            <h2 id="ellie-title" className="text-[15px] font-bold">{step.title}</h2>
            <p id="ellie-text" className="mt-1 text-sm leading-relaxed text-muted-foreground">{step.text}</p>
            <div className="mt-3 flex items-center justify-between gap-2">
              <div className="flex gap-1" aria-label={`Step ${tour.i + 1} of ${tour.steps.length}`}>
                {tour.steps.map((_, i) => (
                  <span key={i} className={cn('h-1.5 rounded-full transition-all', i === tour.i ? 'w-4 bg-accent' : 'w-1.5 bg-border-strong')} />
                ))}
              </div>
              <div className="flex gap-1">
                {tour.i === 0
                  ? <Button size="sm" variant="ghost" onClick={onEnd}>Skip</Button>
                  : <Button size="sm" variant="ghost" onClick={() => go(-1)}>Back</Button>}
                <Button ref={nextBtn} size="sm" variant="accent" onClick={() => (last ? onEnd() : go(1))}>{last ? 'Got it!' : 'Next'}</Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

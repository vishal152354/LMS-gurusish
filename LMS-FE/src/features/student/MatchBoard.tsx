import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// One colour per left item, so each pair's line and both ends share it
const PAIR_COLORS = ['#6c5dd3', '#dc4652', '#0f9f8f', '#e8890c', '#1971c2', '#c2255c', '#5c940d', '#7048e8']
const LETTER = (i: number) => String.fromCharCode(65 + i)

type Side = 'L' | 'R'
interface End { side: Side; i: number }
interface Line { x1: number; y1: number; x2: number; y2: number }

/** Match the following: join each left item to its partner on the right with a line.
 *  Click/tap one item then its partner, or drag from an item's dot to the other side.
 *  `picks[i]` = right index joined to left[i]. */
export function MatchBoard({ left, right, locked, submitting, onSubmit }: {
  left: string[]; right: string[]; locked: boolean; submitting: boolean; onSubmit: (picks: (number | null)[]) => void
}) {
  const [picks, setPicks] = useState<(number | null)[]>(() => left.map(() => null))
  const [selected, setSelected] = useState<End | null>(null)
  const [drag, setDrag] = useState<(End & { x: number; y: number }) | null>(null)
  const [announce, setAnnounce] = useState('')
  const [, setLayoutTick] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const dots = useRef<Record<string, HTMLSpanElement | null>>({})
  const press = useRef<{ end: End; x: number; y: number; moved: boolean } | null>(null)
  const suppressClick = useRef(false)

  useEffect(() => { setPicks(left.map(() => null)); setSelected(null) }, [left, right])

  // Lines are drawn from measured positions — re-measure when the board resizes
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setLayoutTick((t) => t + 1))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const point = useCallback((side: Side, i: number) => {
    const dot = dots.current[`${side}${i}`]
    const b = box.current?.getBoundingClientRect()
    if (!dot || !b) return null
    const r = dot.getBoundingClientRect()
    // start at the dot's inner edge so the line doesn't cover its centre
    return { x: (side === 'L' ? r.right : r.left) - b.left, y: r.top + r.height / 2 - b.top }
  }, [])

  const connect = useCallback((l: number, r: number) => {
    if (locked) return
    setPicks((p) => p.map((x, i) => (i === l ? r : x === r ? null : x)))   // one partner each
    setSelected(null)
    setAnnounce(`Joined “${left[l]}” with “${right[r]}”.`)
    navigator.vibrate?.(10)
  }, [locked, left, right])

  const disconnect = (l: number) => {
    if (locked) return
    setPicks((p) => p.map((x, i) => (i === l ? null : x)))
    setAnnounce(`Removed the line from “${left[l]}”.`)
  }

  const choose = (end: End) => {
    if (locked) return
    if (suppressClick.current) { suppressClick.current = false; return }
    if (!selected || selected.side === end.side) {
      setSelected((s) => (s && s.side === end.side && s.i === end.i ? null : end))
      return
    }
    const l = end.side === 'L' ? end.i : selected.i
    const r = end.side === 'R' ? end.i : selected.i
    connect(l, r)
  }

  // Drag from any item (or its dot) to an item on the other side
  const onPointerDown = (end: End) => (e: React.PointerEvent) => {
    if (locked || e.button !== 0) return
    press.current = { end, x: e.clientX, y: e.clientY, moved: false }
  }
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const p = press.current
      if (!p) return
      if (!p.moved && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 6) return
      p.moved = true
      const b = box.current?.getBoundingClientRect()
      if (b) setDrag({ ...p.end, x: e.clientX - b.left, y: e.clientY - b.top })
    }
    const up = (e: PointerEvent) => {
      const p = press.current
      press.current = null
      if (!p?.moved) return
      setDrag(null)
      suppressClick.current = true
      window.setTimeout(() => { suppressClick.current = false }, 0)
      const target = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-match]')
      if (!target) return
      const [side, idx] = [target.dataset.match![0] as Side, Number(target.dataset.match!.slice(1))]
      if (side === p.end.side) return
      connect(side === 'L' ? idx : p.end.i, side === 'R' ? idx : p.end.i)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [connect])

  const lines: (Line & { l: number })[] = []
  picks.forEach((r, l) => {
    if (r === null) return
    const a = point('L', l), b = point('R', r)
    if (a && b) lines.push({ l, x1: a.x, y1: a.y, x2: b.x, y2: b.y })
  })
  let live: Line | null = null
  if (drag) {
    const a = point(drag.side, drag.i)
    if (a) live = { x1: a.x, y1: a.y, x2: drag.x, y2: drag.y }
  }

  const partnerOf = (r: number) => picks.indexOf(r)
  const joined = picks.filter((p) => p !== null).length
  const allJoined = joined === left.length

  return (
    <div className="flex flex-col gap-4" data-tour="answer-area">
      <div ref={box} className="relative select-none">
        <div className="grid grid-cols-[minmax(0,1fr)_clamp(28px,8vw,96px)_minmax(0,1fr)] gap-y-2.5">
          {left.map((item, i) => {
            const r = picks[i]
            const color = PAIR_COLORS[i % PAIR_COLORS.length]
            const isSel = selected?.side === 'L' && selected.i === i
            return (
              <Item key={`L${i}-${item}`} row={i} side="L" label={String(i + 1)} text={item}
                color={r !== null ? color : null} selected={isSel} locked={locked}
                dotRef={(el) => { dots.current[`L${i}`] = el }}
                ariaLabel={`${i + 1}. ${item}${r !== null ? `, joined with ${LETTER(r)}. ${right[r]}` : ''}`}
                onClick={() => choose({ side: 'L', i })} onPointerDown={onPointerDown({ side: 'L', i })} />
            )
          })}
          {right.map((item, j) => {
            const l = partnerOf(j)
            const color = l !== -1 ? PAIR_COLORS[l % PAIR_COLORS.length] : null
            const isSel = selected?.side === 'R' && selected.i === j
            return (
              <Item key={`R${j}-${item}`} row={j} side="R" label={LETTER(j)} text={item}
                color={color} selected={isSel} locked={locked}
                dotRef={(el) => { dots.current[`R${j}`] = el }}
                ariaLabel={`${LETTER(j)}. ${item}${l !== -1 ? `, joined with ${l + 1}. ${left[l]}` : ''}`}
                onClick={() => choose({ side: 'R', i: j })} onPointerDown={onPointerDown({ side: 'R', i: j })} />
            )
          })}
        </div>

        <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" aria-hidden="true">
          {lines.map(({ l, ...ln }) => {
            const color = PAIR_COLORS[l % PAIR_COLORS.length]
            const d = curve(ln)
            return (
              <g key={l} className="animate-[fade-up_0.2s_ease]">
                <path d={d} fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" />
                {!locked && (
                  // wide invisible hit area: click a line to remove it
                  <path d={d} fill="none" stroke="transparent" strokeWidth={16} className="pointer-events-auto cursor-pointer"
                    onClick={() => disconnect(l)}><title>Remove this line</title></path>
                )}
              </g>
            )
          })}
          {live && <path d={curve(live)} fill="none" stroke="var(--color-accent)" strokeWidth={3} strokeDasharray="6 6" strokeLinecap="round" />}
        </svg>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-subtle-foreground">
          {selected ? 'Now choose its partner on the other side.' : 'Tap an item, then its partner — or drag a line between them. Tap a line to remove it.'}
        </p>
        {joined > 0 && !locked && (
          <Button type="button" size="sm" variant="ghost" onClick={() => { setPicks(left.map(() => null)); setSelected(null) }}>
            <RotateCcw />Clear lines
          </Button>
        )}
      </div>

      <div className="flex justify-end">
        <Button size="lg" className="w-full sm:w-auto" disabled={!allJoined || locked} loading={submitting}
          onClick={() => onSubmit(picks)} data-tour="submit-answer">
          {submitting ? 'Saving…' : allJoined ? 'Submit answer' : `Join ${left.length - joined} more`}
        </Button>
      </div>
      <div className="sr-only" aria-live="polite">{announce}</div>
    </div>
  )
}

// Smooth S-curve between the two dots
function curve({ x1, y1, x2, y2 }: Line) {
  const dx = Math.max(24, Math.abs(x2 - x1) / 2)
  return `M ${x1} ${y1} C ${x1 + (x2 > x1 ? dx : -dx)} ${y1}, ${x2 - (x2 > x1 ? dx : -dx)} ${y2}, ${x2} ${y2}`
}

function Item({ row, side, label, text, color, selected, locked, dotRef, ariaLabel, onClick, onPointerDown }: {
  row: number; side: Side; label: string; text: string; color: string | null; selected: boolean; locked: boolean
  dotRef: (el: HTMLSpanElement | null) => void; ariaLabel: string
  onClick: () => void; onPointerDown: (e: React.PointerEvent) => void
}) {
  // The connector dot carries the item's number/letter and fills with the pair colour once joined
  const dot = (
    <span ref={dotRef} aria-hidden="true"
      className={cn('flex size-7 shrink-0 touch-none items-center justify-center rounded-full border-2 text-xs font-bold transition-colors',
        !color && 'border-border-strong bg-accent-soft text-accent', selected && 'border-accent bg-accent text-accent-foreground')}
      style={color ? { borderColor: color, background: color, color: '#fff' } : undefined}>
      {label}
    </span>
  )
  return (
    <button type="button" data-match={`${side}${row}`} disabled={locked} aria-pressed={selected} aria-label={ariaLabel} lang="en"
      onClick={onClick} onPointerDown={onPointerDown}
      style={{ gridRow: row + 1, gridColumn: side === 'L' ? 1 : 3, ...(color ? { borderColor: color } : {}) }}
      className={cn(
        'flex min-h-14 items-center gap-2 rounded-xl border-2 bg-card px-2.5 py-2.5 text-left text-[13.5px] leading-snug shadow-sm transition-all sm:gap-2.5 sm:px-3 sm:text-[14.5px]',
        !color && 'border-border',
        selected && 'border-accent bg-accent-soft ring-4 ring-accent/20 -translate-y-0.5',
        !locked && 'cursor-pointer hover:border-border-strong hover:shadow-md',
      )}>
      {side === 'R' && dot}
      <span className="min-w-0 flex-1 hyphens-auto break-words">{text}</span>
      {side === 'L' && dot}
    </button>
  )
}

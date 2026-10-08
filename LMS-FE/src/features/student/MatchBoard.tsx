import { useEffect, useRef, useState } from 'react'
import {
  DndContext, DragOverlay, PointerSensor, pointerWithin, rectIntersection, useDraggable, useDroppable, useSensor, useSensors,
  type CollisionDetection, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { GripVertical, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args)
  return hits.length ? hits : rectIntersection(args)
}
const NUM = (i: number) => String(i + 1)

/** Match the following: drag each right-hand card onto its left-hand item
 *  (or tap a card, then tap a slot). `picks[i]` = right index placed on left[i]. */
export function MatchBoard({ left, right, locked, submitting, onSubmit }: {
  left: string[]; right: string[]; locked: boolean; submitting: boolean; onSubmit: (picks: (number | null)[]) => void
}) {
  const [picks, setPicks] = useState<(number | null)[]>(() => left.map(() => null))
  const [dragging, setDragging] = useState<number | null>(null)
  const [selected, setSelected] = useState<number | null>(null)   // tap-to-place
  const [announce, setAnnounce] = useState('')
  const lastDragEnd = useRef(0)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  useEffect(() => { setPicks(left.map(() => null)); setSelected(null) }, [left, right])

  const placedOn = (card: number) => picks.indexOf(card)
  const place = (card: number, slot: number) => {
    if (locked) return
    setPicks((p) => {
      const next = [...p]
      const from = next.indexOf(card)
      if (from !== -1) next[from] = next[slot]            // swap if the card was elsewhere
      next[slot] = card
      return next
    })
    setSelected(null)
    setAnnounce(`“${right[card]}” placed on “${left[slot]}”.`)
    navigator.vibrate?.(10)
  }
  const unplace = (slot: number) => {
    if (locked) return
    setPicks((p) => p.map((x, i) => (i === slot ? null : x)))
  }

  const onDragStart = (e: DragStartEvent) => { setDragging(e.active.data.current?.card as number); setSelected(null) }
  const onDragEnd = (e: DragEndEvent) => {
    const card = e.active.data.current?.card as number
    const overId = e.over?.id
    if (typeof overId === 'string' && overId.startsWith('slot-')) place(card, Number(overId.slice(5)))
    else if (overId === 'pool' || !overId) { const s = placedOn(card); if (s !== -1 && e.active.id.toString().startsWith('placed-')) unplace(s) }
    setDragging(null)
    lastDragEnd.current = Date.now()
  }

  const allPlaced = picks.every((p) => p !== null)
  const free = right.map((_, j) => j).filter((j) => placedOn(j) === -1)

  return (
    <DndContext sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragEnd={onDragEnd}
      onDragCancel={() => setDragging(null)}>
      <div className="flex flex-col gap-4" data-tour="answer-area">
        <ol className="flex flex-col gap-2.5" aria-label="Items to match">
          {left.map((item, i) => (
            <Slot key={`${i}-${item}`} index={i} item={item} card={picks[i] !== null ? right[picks[i]!] : null}
              cardIndex={picks[i]} locked={locked} armed={selected !== null}
              onTap={() => { if (selected !== null) place(selected, i) }}
              onClear={() => unplace(i)} />
          ))}
        </ol>

        <Pool armed={dragging !== null}>
          {free.length === 0 ? (
            <p className="w-full py-2 text-center text-sm text-subtle-foreground">All cards placed — check them, then submit.</p>
          ) : free.map((j) => (
            <Card key={`${j}-${right[j]}`} index={j} text={right[j]} lifting={dragging === j} disabled={locked}
              selected={selected === j}
              onTap={() => { if (Date.now() - lastDragEnd.current > 250) setSelected((s) => (s === j ? null : j)) }} />
          ))}
        </Pool>
        <p className="text-xs text-subtle-foreground">Drag each card onto the item it matches — or tap a card, then tap where it goes.</p>

        <div className="flex justify-end">
          <Button size="lg" className="w-full sm:w-auto" disabled={!allPlaced || locked} loading={submitting}
            onClick={() => onSubmit(picks)} data-tour="submit-answer">
            {submitting ? 'Saving…' : allPlaced ? 'Submit answer' : `Place ${picks.filter((p) => p === null).length} more`}
          </Button>
        </div>
        <div className="sr-only" aria-live="polite">{announce}</div>
      </div>

      <DragOverlay dropAnimation={{ duration: 220, easing: 'cubic-bezier(.3,1.4,.5,1)' }}>
        {dragging !== null && (
          <div className="-rotate-1 scale-[1.03]"><CardFace text={right[dragging]} className="border-accent bg-popover shadow-[var(--shadow-lift)] cursor-grabbing" /></div>
        )}
      </DragOverlay>
    </DndContext>
  )
}

function Slot({ index, item, card, cardIndex, locked, armed, onTap, onClear }: {
  index: number; item: string; card: string | null; cardIndex: number | null; locked: boolean; armed: boolean
  onTap: () => void; onClear: () => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `slot-${index}` })
  const drag = useDraggable({ id: `placed-${index}`, data: { card: cardIndex }, disabled: card === null || locked })
  return (
    <li className="grid items-stretch gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <div className="flex items-center gap-3 rounded-lg border border-border bg-card-strong px-3.5 py-3 text-[15px] font-medium">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-bold text-accent">{NUM(index)}</span>
        {item}
      </div>
      <div
        ref={setNodeRef}
        role="button"
        tabIndex={locked ? -1 : 0}
        aria-label={card ? `Matched with ${card}` : `Drop a card for ${item}`}
        onClick={() => { if (!card || armed) onTap() }}
        onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && armed) { e.preventDefault(); onTap() } }}
        className={cn(
          'flex min-h-12 items-center rounded-lg border-2 border-dashed border-border-strong px-2 transition-all duration-150',
          isOver && 'border-solid border-accent bg-accent-soft scale-[1.01]',
          armed && !card && 'border-accent/60 cursor-pointer',
          card && 'border-solid border-accent/70 bg-accent-soft/60',
        )}
      >
        {card ? (
          <div ref={drag.setNodeRef} {...drag.listeners} {...drag.attributes}
            className={cn('flex flex-1 items-center gap-2 py-1.5 animate-[fade-up_0.2s_ease] touch-none select-none', !locked && 'cursor-grab', drag.isDragging && 'opacity-0')}>
            <span className="flex-1 text-[15px]">{card}</span>
            {!locked && (
              <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onClear() }}
                aria-label="Remove card" className="flex size-7 items-center justify-center rounded-full border border-border text-muted-foreground hover:text-foreground cursor-pointer">
                <X className="size-3.5" />
              </button>
            )}
          </div>
        ) : (
          <span className="w-full text-center text-sm text-subtle-foreground">{armed ? 'Tap to place here' : 'Drop a card here'}</span>
        )}
      </div>
    </li>
  )
}

function Pool({ armed, children }: { armed: boolean; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'pool' })
  return (
    <div ref={setNodeRef} aria-label="Cards to place"
      className={cn('flex min-h-16 flex-wrap gap-2 rounded-xl border border-border bg-white/[0.025] p-3 transition-colors', armed && 'border-dashed', isOver && 'bg-accent-soft/40')}>
      {children}
    </div>
  )
}

function Card({ index, text, lifting, disabled, selected, onTap }: {
  index: number; text: string; lifting: boolean; disabled: boolean; selected: boolean; onTap: () => void
}) {
  const { setNodeRef, listeners, attributes } = useDraggable({ id: `card-${index}`, data: { card: index }, disabled })
  return (
    <button ref={setNodeRef} type="button" {...listeners} {...attributes} onClick={onTap} disabled={disabled}
      aria-pressed={selected} aria-label={`Card: ${text}. Press to pick it up, then choose an item.`}
      className={cn('group touch-none select-none text-left', !disabled && 'cursor-grab')}>
      <CardFace text={text} grip className={cn(
        'group-hover:border-border-strong',
        lifting && 'opacity-30 border-dashed',
        selected && 'border-accent bg-accent-soft ring-2 ring-accent/40 -translate-y-0.5',
      )} />
    </button>
  )
}

function CardFace({ text, grip, className }: { text: string; grip?: boolean; className?: string }) {
  return (
    <div className={cn('flex items-center gap-2 rounded-lg border-[1.5px] border-border bg-card px-3 py-2.5 text-[14.5px] leading-snug transition-all', className)}>
      {grip && <GripVertical className="size-4 shrink-0 text-subtle-foreground" aria-hidden="true" />}
      <span>{text}</span>
    </div>
  )
}

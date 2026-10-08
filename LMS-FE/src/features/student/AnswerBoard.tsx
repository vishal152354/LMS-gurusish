import { useEffect, useRef, useState } from 'react'
import {
  DndContext, DragOverlay, PointerSensor, pointerWithin, rectIntersection, useDraggable, useDroppable, useSensor, useSensors,
  type CollisionDetection, type DragEndEvent, type DragOverEvent, type DragStartEvent, type Modifier,
} from '@dnd-kit/core'
import { CheckCircle2, GripVertical, Inbox, X, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const LETTERS = 'ABCDEFGH'
const SLOT_ID = 'answer-slot'
const SLOTTED_ID = 'slotted'

export interface Reveal { correct: number; chosen: number }

interface Props {
  options: string[]
  locked: boolean            // while submitting / after reveal
  reveal: Reveal | null
  submitting: boolean
  keyboardEnabled: boolean   // false while a dialog is open
  onSubmit: (index: number) => void
}

// Prefer the pointer position; fall back to overlap so fast flicks still land.
const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args)
  return hits.length ? hits : rectIntersection(args)
}

// When the dragged chip is over the slot, pull it 35% toward the slot centre.
const magnet: Modifier = ({ transform, draggingNodeRect, over }) => {
  if (!draggingNodeRect || !over || over.id !== SLOT_ID) return transform
  const cx = draggingNodeRect.left + transform.x + draggingNodeRect.width / 2
  const cy = draggingNodeRect.top + transform.y + draggingNodeRect.height / 2
  const tx = over.rect.left + over.rect.width / 2
  const ty = over.rect.top + over.rect.height / 2
  return { ...transform, x: transform.x + (tx - cx) * 0.35, y: transform.y + (ty - cy) * 0.35 }
}

export function AnswerBoard({ options, locked, reveal, submitting, keyboardEnabled, onSubmit }: Props) {
  const [chosen, setChosen] = useState<number | null>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  const [overSlot, setOverSlot] = useState(false)
  // Read by DragOverlay at the moment of drop, so it must outlive onDragEnd —
  // reset only when the next drag starts.
  const [dropOnSlot, setDropOnSlot] = useState(false)
  const [justPlaced, setJustPlaced] = useState(0) // bumps to replay the "landed" animation
  const [announce, setAnnounce] = useState('')
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  // A drag that ends back on its own chip would also fire a click — ignore it
  const lastDragEnd = useRef(0)

  // New question → reset
  useEffect(() => { setChosen(null); setAnnounce('') }, [options])

  const place = (i: number) => {
    if (locked) return
    setChosen(i)
    setJustPlaced((n) => n + 1)
    setAnnounce(`Option ${LETTERS[i]} placed in the answer box. Press Submit answer to confirm.`)
    navigator.vibrate?.(10)
  }
  const clear = () => {
    if (locked || chosen === null) return
    setChosen(null)
    setAnnounce('Answer box cleared.')
  }

  // Keyboard shortcuts: A–D place, Enter submits, Backspace clears
  useEffect(() => {
    if (!keyboardEnabled || locked) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement
      if (t.matches('input, textarea, select')) return
      const n = LETTERS.indexOf(e.key.toUpperCase())
      if (n >= 0 && n < options.length) { e.preventDefault(); place(n) }
      else if (e.key === 'Enter' && chosen !== null && !t.matches('button')) { e.preventDefault(); onSubmit(chosen) }
      else if ((e.key === 'Backspace' || e.key === 'Delete') && chosen !== null) { e.preventDefault(); clear() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const onDragStart = (e: DragStartEvent) => {
    setDragging(e.active.data.current?.index as number)
    setDropOnSlot(false)
    navigator.vibrate?.(8)
  }
  const onDragOver = (e: DragOverEvent) => { const on = e.over?.id === SLOT_ID; setOverSlot(on); setDropOnSlot(on) }
  const onDragEnd = (e: DragEndEvent) => {
    const idx = e.active.data.current?.index as number
    const fromSlot = e.active.id === SLOTTED_ID
    if (e.over?.id === SLOT_ID) { if (!fromSlot) place(idx) }
    else if (fromSlot) clear()       // dragged the answer back out of the box
    setDragging(null)
    setOverSlot(false)
    lastDragEnd.current = Date.now()
  }

  const correctIdx = reveal?.correct
  const wasRight = reveal ? reveal.chosen === reveal.correct : null

  return (
    <DndContext sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragOver={onDragOver}
      onDragEnd={onDragEnd} onDragCancel={() => { setDragging(null); setOverSlot(false) }}>
      <div className="flex flex-col gap-3" data-tour="answer-area">
        <Slot
          chosen={chosen}
          option={chosen !== null ? options[chosen] : null}
          active={dragging !== null}
          over={overSlot}
          landedKey={justPlaced}
          state={reveal ? (wasRight ? 'correct' : 'wrong') : null}
          locked={locked}
          onClear={clear}
        />

        <p className="text-xs text-subtle-foreground" hidden={!!reveal}>
          Drag an option into the box — or tap it, or press {LETTERS[0]}–{LETTERS[options.length - 1]}.
        </p>

        <div className="flex flex-col gap-2" role="list" aria-label="Answer options">
          {options.map((opt, i) => (
            <Chip
              key={`${i}-${opt}`}
              index={i}
              text={opt}
              placed={chosen === i}
              lifting={dragging === i}
              disabled={locked}
              tone={reveal ? (i === correctIdx ? 'correct' : i === reveal.chosen ? 'wrong' : 'dim') : null}
              onTap={() => { if (Date.now() - lastDragEnd.current > 250) place(i) }}
            />
          ))}
        </div>

        {!reveal && (
          <div className="mt-1 flex justify-end">
            <Button size="lg" className="w-full sm:w-auto" disabled={chosen === null || locked} loading={submitting}
              onClick={() => chosen !== null && onSubmit(chosen)} data-tour="submit-answer">
              {submitting ? 'Saving…' : 'Submit answer'}
            </Button>
          </div>
        )}
        <div className="sr-only" aria-live="polite">{announce}</div>
      </div>

      {/* The lifted copy that follows the pointer. Dropping on the slot skips the
          return animation (the slot animates its own arrival); anywhere else it
          springs back to its place in the list. */}
      <DragOverlay
        modifiers={[magnet]}
        dropAnimation={dropOnSlot ? null : { duration: 260, easing: 'cubic-bezier(.3,1.4,.5,1)' }}
      >
        {dragging !== null && (
          <div className={cn('transition-transform duration-150', overSlot ? 'scale-[0.98] rotate-0' : 'scale-[1.03] -rotate-1')}>
            <ChipFace letter={LETTERS[dragging]} text={options[dragging]} className="border-accent bg-popover shadow-[var(--shadow-lift)] cursor-grabbing" />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}

function Slot({ chosen, option, active, over, landedKey, state, locked, onClear }: {
  chosen: number | null; option: string | null; active: boolean; over: boolean; landedKey: number
  state: 'correct' | 'wrong' | null; locked: boolean; onClear: () => void
}) {
  const { setNodeRef } = useDroppable({ id: SLOT_ID })
  const drag = useDraggable({ id: SLOTTED_ID, data: { index: chosen }, disabled: chosen === null || locked })

  return (
    <div
      ref={setNodeRef}
      aria-label="Answer box"
      className={cn(
        'relative flex min-h-16 items-center rounded-lg border-2 border-dashed p-2 transition-all duration-200',
        'border-border-strong bg-white/[0.025]',
        active && 'border-accent/60',
        over && 'border-solid border-accent bg-accent-soft shadow-[0_0_0_4px_rgb(125_211_252/0.12)]',
        option && !state && 'border-solid border-accent bg-accent-soft/70',
        state === 'correct' && 'border-solid border-success bg-success-soft',
        state === 'wrong' && 'border-solid border-destructive bg-destructive-soft',
      )}
    >
      {option === null ? (
        <div className={cn('flex flex-1 items-center justify-center gap-2.5 text-sm text-subtle-foreground transition-colors', active && 'text-accent')}>
          <Inbox className="size-4" aria-hidden="true" />Drag the correct option here
        </div>
      ) : (
        <div
          key={landedKey}
          ref={drag.setNodeRef}
          {...drag.listeners}
          {...drag.attributes}
          role="group"
          aria-roledescription="answer"
          className={cn(
            'flex flex-1 items-center gap-3 rounded-md px-2 py-1.5 animate-[fade-up_0.22s_ease] touch-none select-none',
            !locked && 'cursor-grab',
            drag.isDragging && 'opacity-0',
          )}
        >
          <LetterDot letter={LETTERS[chosen!]} tone={state ?? 'accent'} />
          <span className="flex-1 text-[15px] leading-snug">{option}</span>
          {state === 'correct' && <CheckCircle2 className="size-5 text-success" aria-label="Correct" />}
          {state === 'wrong' && <XCircle className="size-5 text-destructive" aria-label="Incorrect" />}
          {!locked && (
            <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={onClear} aria-label="Remove answer"
              className="flex size-8 items-center justify-center rounded-full border border-border text-muted-foreground hover:border-border-strong hover:text-foreground cursor-pointer">
              <X className="size-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function Chip({ index, text, placed, lifting, disabled, tone, onTap }: {
  index: number; text: string; placed: boolean; lifting: boolean; disabled: boolean
  tone: 'correct' | 'wrong' | 'dim' | null; onTap: () => void
}) {
  const { setNodeRef, listeners, attributes } = useDraggable({ id: `opt-${index}`, data: { index }, disabled })
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...listeners}
      {...attributes}
      role="listitem"
      onClick={onTap}
      disabled={disabled}
      aria-label={`Option ${LETTERS[index]}: ${text}. Press to place in the answer box.`}
      className={cn('group block w-full text-left touch-none select-none disabled:cursor-default', !disabled && 'cursor-grab')}
    >
      <ChipFace
        letter={LETTERS[index]}
        text={text}
        grip={!disabled}
        tone={tone === 'correct' ? 'correct' : tone === 'wrong' ? 'wrong' : undefined}
        className={cn(
          !disabled && 'group-hover:border-border-strong group-hover:bg-card-strong',
          (placed || lifting) && !tone && 'border-dashed opacity-35',
          tone === 'dim' && 'opacity-55',
        )}
      />
    </button>
  )
}

function ChipFace({ letter, text, grip, tone, className }: { letter: string; text: string; grip?: boolean; tone?: 'correct' | 'wrong'; className?: string }) {
  return (
    <div className={cn(
      'flex items-center gap-3 rounded-lg border-[1.5px] border-border bg-card px-3.5 py-3 text-[15px] leading-snug transition-colors',
      tone === 'correct' && 'border-success bg-success-soft',
      tone === 'wrong' && 'border-destructive bg-destructive-soft',
      className,
    )}>
      {grip && <GripVertical className="size-4 shrink-0 text-subtle-foreground opacity-60 transition-opacity group-hover:opacity-100" aria-hidden="true" />}
      <LetterDot letter={letter} tone={tone} />
      <span className="flex-1">{text}</span>
    </div>
  )
}

function LetterDot({ letter, tone }: { letter: string; tone?: 'correct' | 'wrong' | 'accent' }) {
  return (
    <span className={cn(
      'flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-card-strong text-xs font-bold',
      tone === 'accent' && 'border-transparent bg-accent text-accent-foreground',
      tone === 'correct' && 'border-transparent bg-success text-success-foreground',
      tone === 'wrong' && 'border-transparent bg-destructive text-destructive-foreground',
    )}>{letter}</span>
  )
}

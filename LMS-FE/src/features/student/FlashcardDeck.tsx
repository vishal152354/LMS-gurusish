import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Lightbulb, RotateCcw, Shuffle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { TestFlashcard } from '@/types/api'

/** One card at a time: click (or Space) to flip, arrows to move. */
export function FlashcardDeck({ cards, keyboardEnabled = true }: { cards: TestFlashcard[]; keyboardEnabled?: boolean }) {
  const [order, setOrder] = useState(() => cards.map((_, i) => i))
  const [at, setAt] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [seen, setSeen] = useState<Set<number>>(() => new Set([0]))

  // More cards can arrive while the deck is still being written
  useEffect(() => {
    setOrder((o) => (o.length === cards.length ? o : [...o, ...cards.map((_, i) => i).slice(o.length)]))
  }, [cards])

  const go = (i: number) => {
    const next = Math.max(0, Math.min(order.length - 1, i))
    setAt(next); setFlipped(false)
    setSeen((s) => new Set(s).add(next))
  }
  const shuffle = () => {
    const o = [...order]
    for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [o[i], o[j]] = [o[j], o[i]] }
    setOrder(o); setAt(0); setFlipped(false); setSeen(new Set([0]))
  }

  useEffect(() => {
    if (!keyboardEnabled) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, [contenteditable]')) return
      if (e.key === 'ArrowRight') go(at + 1)
      else if (e.key === 'ArrowLeft') go(at - 1)
      else if (e.key === ' ') { e.preventDefault(); setFlipped((f) => !f) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!cards.length) return null
  const card = cards[order[at]] ?? cards[0]
  const face = 'absolute inset-0 flex flex-col rounded-xl border p-6 sm:p-8 [backface-visibility:hidden]'

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-muted-foreground tabular">Card {at + 1} of {order.length} · {seen.size} seen</span>
        <Button size="sm" variant="ghost" onClick={shuffle}><Shuffle />Shuffle</Button>
      </div>

      <button type="button" onClick={() => setFlipped((f) => !f)} aria-label={flipped ? 'Show the question' : 'Show the answer'}
        className="relative h-72 w-full cursor-pointer text-left [perspective:1200px] sm:h-64">
        <div className={cn('relative size-full transition-transform duration-500 [transform-style:preserve-3d]', flipped && '[transform:rotateY(180deg)]')}>
          <div className={cn(face, 'border-border bg-card shadow-sm')}>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="accent">{card.topic}</Badge>
              <span className="truncate text-xs text-subtle-foreground">{card.source}</span>
            </div>
            <p className="my-auto py-4 text-center text-lg font-semibold leading-relaxed sm:text-xl">{card.question}</p>
            <p className="text-center text-xs text-subtle-foreground">Tap to see the answer</p>
          </div>
          <div className={cn(face, 'overflow-y-auto border-accent/40 bg-accent-soft [transform:rotateY(180deg)]')}>
            <p className="text-xs font-semibold uppercase tracking-wider text-accent">Answer</p>
            <p className="my-auto py-3 text-center text-base leading-relaxed sm:text-lg">{card.answer}</p>
            {card.tip && (
              <p className="flex gap-2 text-sm text-muted-foreground"><Lightbulb className="mt-0.5 size-4 shrink-0 text-accent" />{card.tip}</p>
            )}
          </div>
        </div>
      </button>

      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" onClick={() => go(at - 1)} disabled={at === 0}><ChevronLeft />Previous</Button>
        <Button variant="ghost" size="sm" onClick={() => setFlipped((f) => !f)}><RotateCcw />Flip</Button>
        <Button variant="outline" onClick={() => go(at + 1)} disabled={at >= order.length - 1}>Next<ChevronRight /></Button>
      </div>
      <p className="text-center text-xs text-subtle-foreground">Keyboard: ← → to move, Space to flip</p>
    </div>
  )
}

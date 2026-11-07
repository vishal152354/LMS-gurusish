import { useEffect, useRef } from 'react'
import { ArrowRight, Check, CheckCircle2, Lightbulb, MinusCircle, X, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { QuestionLogEntry } from '@/types/api'

const fmt = (n: number) => String(Math.round(n * 100) / 100)

/** Guided tests: how the answer just given was marked, and why. */
export function AnswerFeedback({ review, last, onNext }: { review: QuestionLogEntry; last: boolean; onNext: () => void }) {
  const next = useRef<HTMLButtonElement>(null)
  useEffect(() => { const t = window.setTimeout(() => next.current?.focus(), 300); return () => window.clearTimeout(t) }, [review])

  const partial = !review.is_correct && review.type === 'match' && review.marks_awarded > 0
  const verdict = review.is_correct ? 'Correct!' : partial ? 'Partly right' : 'Not quite'
  const Icon = review.is_correct ? CheckCircle2 : partial ? MinusCircle : XCircle
  const tone = review.is_correct ? 'success' : partial ? 'warning' : 'destructive'
  const yours = review.student_answer !== undefined ? review.student_answer
    : review.selected_index != null && review.options ? review.options[review.selected_index] : null

  return (
    <Card className={cn('mt-5 animate-fade-up border-2',
      tone === 'success' && 'border-success/50', tone === 'warning' && 'border-warning/50', tone === 'destructive' && 'border-destructive/40')}
      role="status" aria-live="polite">
      <CardContent className="flex flex-col gap-4 p-6">
        <div className="flex items-center justify-between gap-3">
          <span className={cn('flex items-center gap-2 text-lg font-semibold',
            tone === 'success' && 'text-success-text', tone === 'warning' && 'text-warning-text', tone === 'destructive' && 'text-destructive-text')}>
            <Icon className="size-6" />{verdict}
          </span>
          {review.max_marks != null && (
            <span className="rounded-full border border-border bg-muted px-3 py-1 text-sm font-semibold tabular">
              {fmt(review.marks_awarded)} / {fmt(review.max_marks)} marks
            </span>
          )}
        </div>

        {review.type === 'match' && review.pairs ? (
          <ul className="flex flex-col gap-1.5 text-sm">
            {review.pairs.map((p) => (
              <li key={p.left} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                {p.ok ? <Check className="size-4 text-success" strokeWidth={3} /> : <X className="size-4 text-destructive" strokeWidth={3} />}
                <span className="font-semibold">{p.left}</span><span className="text-muted-foreground">→</span>
                <span>{p.correct}</span>
                {!p.ok && <span className="text-xs text-muted-foreground">(you chose {p.chosen ?? 'nothing'})</span>}
              </li>
            ))}
          </ul>
        ) : (
          <div className="grid gap-2 text-sm sm:grid-cols-2">
            {!review.is_correct && (
              <div className="rounded-lg border border-destructive/30 bg-destructive-soft px-3 py-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-destructive-text">Your answer</p>
                <p className="mt-0.5">{yours || '—'}</p>
              </div>
            )}
            <div className={cn('rounded-lg border border-success/30 bg-success-soft px-3 py-2', review.is_correct && 'sm:col-span-2')}>
              <p className="text-xs font-semibold uppercase tracking-wide text-success-text">Correct answer</p>
              <p className="mt-0.5">{review.correct_answer ?? review.correct_option}</p>
            </div>
          </div>
        )}

        {review.explanation && (
          <p className="flex gap-2 rounded-lg bg-muted px-3 py-2.5 text-sm text-muted-foreground">
            <Lightbulb className="mt-0.5 size-4 shrink-0 text-accent" />{review.explanation}
          </p>
        )}

        <Button ref={next} size="lg" onClick={onNext} className="self-end">
          {last ? 'See my result' : 'Next question'}<ArrowRight />
        </Button>
      </CardContent>
    </Card>
  )
}

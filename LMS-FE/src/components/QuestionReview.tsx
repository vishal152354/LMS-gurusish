import { Check, Minus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { MatchPair, QuestionType } from '@/types/api'
import { ANSWER_COLORS } from './AnswerDonut'

export interface ReviewItem {
  number: number
  type?: QuestionType
  question: string
  chosen: string | null
  correct_option: string
  is_correct: boolean
  explanation?: string
  marks?: number | null
  maxMarks?: number | null
  pairs?: MatchPair[] | null
}

const TYPE_LABEL: Record<QuestionType, string> = { mcq: 'Multiple choice', fill_blank: 'Fill in the blank', match: 'Match the following' }

// 0.25 → "0.25", 0.5 → "0.5", 2 → "2"
const fmt = (n: number) => String(Math.round(n * 100) / 100)

export function QuestionReview({ items, className }: { items: ReviewItem[]; className?: string }) {
  return (
    <ol className={cn('flex flex-col gap-2', className)}>
      {items.map((q) => {
        const partial = q.type === 'match' && !q.is_correct && (q.marks ?? 0) > 0
        const tone = q.is_correct ? ANSWER_COLORS.correct : partial ? '#fbbf24' : ANSWER_COLORS.wrong
        return (
          <li key={q.number} className="flex gap-3 rounded-lg border border-white/5 bg-white/[0.03] p-3.5">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full"
              style={{ background: `${tone}26`, color: tone }}
              aria-label={q.is_correct ? 'Correct' : partial ? 'Partly correct' : 'Wrong'}>
              {q.is_correct ? <Check className="size-3.5" strokeWidth={3} /> : partial ? <Minus className="size-3.5" strokeWidth={3} /> : <X className="size-3.5" strokeWidth={3} />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p className="text-sm leading-relaxed"><span className="text-muted-foreground tabular">Q{q.number}. </span>{q.question}</p>
                {q.maxMarks != null && q.marks != null && (
                  <span className="text-xs font-semibold text-muted-foreground tabular">{fmt(q.marks)} / {fmt(q.maxMarks)}</span>
                )}
              </div>
              {q.type && <p className="mt-0.5 text-[11px] uppercase tracking-wide text-subtle-foreground">{TYPE_LABEL[q.type]}</p>}

              {q.type === 'match' && q.pairs ? (
                <ul className="mt-2 flex flex-col gap-1 text-xs">
                  {q.pairs.map((p) => (
                    <li key={p.left} className="flex flex-wrap items-center gap-x-1.5">
                      <span className={cn('font-semibold', p.ok ? 'text-success-text' : 'text-destructive-text')}>{p.ok ? '✓' : '✕'}</span>
                      <span className="text-foreground">{p.left}</span>
                      <span className="text-muted-foreground">→</span>
                      {p.ok ? (
                        <span className="font-semibold text-success-text">{p.correct}</span>
                      ) : (
                        <>
                          <span className="font-semibold text-destructive-text line-through decoration-1">{p.chosen ?? 'not placed'}</span>
                          <span className="text-muted-foreground">· correct:</span>
                          <span className="font-semibold text-success-text">{p.correct}</span>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {q.is_correct ? (
                    <>Answered: <span className="font-semibold text-success-text">{q.chosen}</span></>
                  ) : (
                    <>
                      {q.chosen ? <>Answered: <span className="font-semibold text-destructive-text">{q.chosen}</span> · </> : <span className="font-semibold text-destructive-text">Not answered · </span>}
                      Correct: <span className="font-semibold text-success-text">{q.correct_option}</span>
                    </>
                  )}
                </p>
              )}
              {q.explanation && <p className="mt-1.5 text-xs leading-relaxed text-subtle-foreground">{q.explanation}</p>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

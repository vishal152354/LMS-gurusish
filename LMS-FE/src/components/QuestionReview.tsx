import { Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ANSWER_COLORS } from './AnswerDonut'

export interface ReviewItem {
  number: number
  question: string
  chosen: string | null
  correct_option: string
  is_correct: boolean
  explanation?: string
}

export function QuestionReview({ items, className }: { items: ReviewItem[]; className?: string }) {
  return (
    <ol className={cn('flex flex-col gap-2', className)}>
      {items.map((q) => (
        <li key={q.number} className="flex gap-3 rounded-lg border border-white/5 bg-white/[0.03] p-3.5">
          <span
            className="flex size-6 shrink-0 items-center justify-center rounded-full"
            style={{ background: `${q.is_correct ? ANSWER_COLORS.correct : ANSWER_COLORS.wrong}26`, color: q.is_correct ? ANSWER_COLORS.correct : ANSWER_COLORS.wrong }}
            aria-label={q.is_correct ? 'Correct' : 'Wrong'}
          >
            {q.is_correct ? <Check className="size-3.5" strokeWidth={3} /> : <X className="size-3.5" strokeWidth={3} />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm leading-relaxed"><span className="text-muted-foreground tabular">Q{q.number}. </span>{q.question}</p>
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
            {q.explanation && <p className="mt-1.5 text-xs leading-relaxed text-subtle-foreground">{q.explanation}</p>}
          </div>
        </li>
      ))}
    </ol>
  )
}

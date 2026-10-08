import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import moment from 'moment'
import { ArrowLeft, Award, Lightbulb, Target } from 'lucide-react'
import { AnswerDonut } from '@/components/AnswerDonut'
import { QuestionReview, type ReviewItem } from '@/components/QuestionReview'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useTour } from '@/features/guide/guideContext'
import { apiError } from '@/services/http'
import { studentApi } from '@/services/studentApi'
import { useAppSelector } from '@/store'
import type { QuestionLogEntry } from '@/types/api'

interface View {
  title: string
  marks: number
  maxMarks: number | null
  grade: string
  comment: string
  improve: string[]
  correct: number
  wrong: number
  unanswered: number
  review: ReviewItem[] | null
  when: string | null
}

// works for every question type, and for older MCQ-only attempts
const chosenOf = (q: QuestionLogEntry) =>
  q.student_answer !== undefined ? q.student_answer : q.selected_index != null && q.options ? q.options[q.selected_index] : null
const unansweredIn = (log: QuestionLogEntry[]) => log.filter((q) => !q.is_correct && chosenOf(q) == null).length

const toReview = (log: QuestionLogEntry[]): ReviewItem[] => log.map((q) => ({
  number: q.question_number, type: q.type ?? 'mcq', question: q.question,
  chosen: chosenOf(q), correct_option: q.correct_answer ?? q.correct_option,
  is_correct: q.is_correct, explanation: q.explanation,
  marks: q.marks_awarded, maxMarks: q.max_marks ?? null, pairs: q.pairs ?? null,
}))

export default function ResultPage() {
  const { eventId = '' } = useParams()
  const uploadId = useSearchParams()[0].get('upload') ?? ''
  const student = useAppSelector((s) => s.auth.student)!
  const saved = useAppSelector((s) => s.results.byEvent[eventId])
  const [view, setView] = useState<View | null>(null)
  const [error, setError] = useState<string | null>(null)
  useTour('student-result', !!view)

  useEffect(() => {
    let cancelled = false
    async function load() {
      // 1) Finished on this device — full detail is already here
      if (saved) {
        const unanswered = unansweredIn(saved.question_log)
        setView({
          title: saved.title ?? saved.filename, marks: saved.final_marks, maxMarks: saved.max_marks, grade: saved.grade,
          comment: saved.feedback, improve: saved.areas_to_improve,
          correct: saved.correct_count, wrong: saved.total_questions - saved.correct_count - unanswered, unanswered,
          review: toReview(saved.question_log), when: saved.finishedAt,
        })
        // results saved before titles were stored: look the test's name up
        if (!saved.title) {
          studentApi.myTests(student.roll).then((tests) => {
            const t = tests.find((x) => x.event_id === eventId)
            if (t && !cancelled) setView((v) => (v ? { ...v, title: t.title } : v))
          }).catch(() => {})
        }
        return
      }
      // 2) Otherwise ask the backend, plus the test list for the title and maximum marks
      try {
        const [res, tests] = await Promise.all([
          studentApi.result(student.id, uploadId, eventId),
          studentApi.myTests(student.roll).catch(() => []),
        ])
        if (cancelled) return
        const test = tests.find((t) => t.event_id === eventId)
        const maxMarks = res.max_marks ?? test?.max_marks ?? null
        const mpq = test && test.num_questions ? test.max_marks / test.num_questions : 1
        const log = res.question_log ?? []
        const correct = log.length ? log.filter((q) => q.is_correct).length : Math.round(res.final_marks / mpq)
        const total = log.length || test?.num_questions || correct
        const unanswered = unansweredIn(log)
        setView({
          title: test?.title ?? res.filename, marks: res.final_marks, maxMarks, grade: res.grade,
          comment: res.overall_comment, improve: res.areas_to_improve ?? [],
          correct, wrong: Math.max(0, total - correct - unanswered), unanswered,
          review: log.length ? toReview(log) : null, when: res.date || null,
        })
      } catch (e) {
        if (!cancelled) setError(apiError(e, 'Could not load this result.'))
      }
    }
    load()
    return () => { cancelled = true }
  }, [saved, student.id, student.roll, uploadId, eventId])

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Button asChild variant="ghost" size="sm" className="-ml-3"><Link to="/student"><ArrowLeft />My tests</Link></Button>

      {error && <Card className="mt-6"><CardContent className="p-6 text-sm text-destructive-text">{error}</CardContent></Card>}
      {!view && !error && <div className="mt-6 flex flex-col gap-4"><Skeleton className="h-56 rounded-xl" /><Skeleton className="h-72 rounded-xl" /></div>}

      {view && (
        <div className="mt-4 flex flex-col gap-5 animate-fade-up">
          <Card data-tour="result-score">
            <CardContent className="flex flex-col gap-6 p-7 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Test complete</p>
                <h1 className="mt-2 font-display text-3xl font-semibold">{view.title}</h1>
                {view.when && <p className="mt-1 text-sm text-muted-foreground">{moment(view.when).format('D MMM YYYY, h:mm a')}</p>}
                <div className="mt-5 flex items-end gap-4">
                  <span className="font-display text-5xl font-semibold tabular">{view.marks}<span className="text-2xl text-muted-foreground">{view.maxMarks != null && ` / ${view.maxMarks}`}</span></span>
                  <span className="mb-1.5 flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent-soft px-3 py-1 text-sm font-bold text-accent">
                    <Award className="size-4" />{view.grade}
                  </span>
                </div>
              </div>
              <AnswerDonut correct={view.correct} wrong={view.wrong} unanswered={view.unanswered} size={150} />
            </CardContent>
          </Card>

          {(view.comment || view.improve.length > 0) && (
            <Card>
              <CardContent className="grid gap-5 p-6 sm:grid-cols-2">
                {view.comment && (
                  <div className="flex gap-3"><Lightbulb className="mt-0.5 size-5 shrink-0 text-accent" />
                    <div><p className="text-sm font-semibold">Summary</p><p className="mt-1 text-sm text-muted-foreground">{view.comment}</p></div>
                  </div>
                )}
                {view.improve.length > 0 && (
                  <div className="flex gap-3"><Target className="mt-0.5 size-5 shrink-0 text-warning" />
                    <div>
                      <p className="text-sm font-semibold">Revise these</p>
                      <ul className="mt-1 list-disc pl-4 text-sm text-muted-foreground">{view.improve.map((a) => <li key={a}>{a}</li>)}</ul>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Card data-tour="result-review">
            <CardHeader><CardTitle>Question by question</CardTitle></CardHeader>
            <CardContent>
              {view.review ? <QuestionReview items={view.review} /> : (
                <p className="text-sm text-muted-foreground">A per-question breakdown isn’t available for this attempt.</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </main>
  )
}

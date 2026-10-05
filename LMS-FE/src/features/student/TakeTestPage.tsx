import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { AlertTriangle, ArrowRight, CheckCircle2, Maximize, ShieldAlert, Timer, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Brand } from '@/components/Brand'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { exitFullscreen, useIntegrityGuard } from '@/hooks/useIntegrityGuard'
import { cn } from '@/lib/utils'
import { apiError } from '@/services/http'
import { studentApi } from '@/services/studentApi'
import { useAppDispatch, useAppSelector } from '@/store'
import { resultSaved } from '@/store/resultsSlice'
import type { AnswerResponse, Flashcard, StudentTest } from '@/types/api'
import { AnswerBoard, type Reveal } from './AnswerBoard'

type Phase = 'ready' | 'starting' | 'question' | 'feedback' | 'finishing' | 'error'

interface QuestionState { number: number; text: string; options: string[] }

export default function TakeTestPage() {
  const { eventId = '' } = useParams()
  const [params] = useSearchParams()
  const uploadId = params.get('upload') ?? ''
  const test = (useLocation().state as { test?: StudentTest } | null)?.test
  const student = useAppSelector((s) => s.auth.student)!
  const dispatch = useAppDispatch()
  const navigate = useNavigate()

  const [phase, setPhase] = useState<Phase>('ready')
  const [error, setError] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [question, setQuestion] = useState<QuestionState | null>(null)
  const [total, setTotal] = useState(test?.num_questions ?? 0)
  const [maxMarks, setMaxMarks] = useState(test?.max_marks ?? 0)
  const [score, setScore] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [reveal, setReveal] = useState<Reveal | null>(null)
  const [card, setCard] = useState<Flashcard | null>(null)
  const pending = useRef<AnswerResponse | null>(null)
  const [elapsed, setElapsed] = useState(0)

  const integrity = useIntegrityGuard(sessionId)
  const inProgress = phase === 'question' || phase === 'feedback'

  // timer
  useEffect(() => {
    if (!inProgress) return
    const t = window.setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => window.clearInterval(t)
  }, [inProgress])

  // warn before leaving mid-test
  useEffect(() => {
    if (!inProgress) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [inProgress])

  useEffect(() => () => exitFullscreen(), [])

  async function start() {
    if (!uploadId) { setError('This link is missing its test details. Go back to My tests and start again.'); setPhase('error'); return }
    integrity.enterFullscreen()     // needs this click as the user gesture
    setPhase('starting')
    try {
      const r = await studentApi.startTest(student.id, uploadId, eventId)
      setSessionId(r.session_id)
      setTotal(r.total_questions)
      setMaxMarks(r.total_marks)
      setQuestion({ number: r.question_number, text: r.first_question_text, options: r.options })
      setPhase('question')
    } catch (e) {
      exitFullscreen()
      setError(apiError(e))
      setPhase('error')
    }
  }

  async function submit(index: number) {
    if (!sessionId || submitting) return
    setSubmitting(true)
    try {
      const r = await studentApi.answer(sessionId, String.fromCharCode(65 + index))
      pending.current = r
      setReveal({ correct: r.correct_index, chosen: index })
      setScore(r.viva_complete ? r.final_marks : r.score_so_far)
      setCard(r.flashcard)
      setPhase('feedback')
    } catch (e) {
      toast.error('Answer not submitted', { description: apiError(e) })
    } finally {
      setSubmitting(false)
    }
  }

  function next() {
    const r = pending.current
    if (!r) return
    setCard(null)
    if (r.viva_complete) {
      setPhase('finishing')
      dispatch(resultSaved({ eventId, result: r, title: test?.title }))
      exitFullscreen()
      navigate(`/student/result/${eventId}?upload=${encodeURIComponent(uploadId)}`, { replace: true })
      return
    }
    setReveal(null)
    setQuestion({ number: r.question_number, text: r.next_question_text, options: r.options })
    setPhase('question')
  }

  const answered = question ? question.number - (phase === 'feedback' ? 0 : 1) : 0
  const pct = total ? (answered / total) * 100 : 0
  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`

  // ── pre-start / error screens ──────────────────────────────
  if (phase === 'ready' || phase === 'starting' || phase === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 py-10">
        <Card className="w-full max-w-lg animate-fade-up">
          <CardContent className="flex flex-col gap-5 p-8">
            <Brand />
            {phase === 'error' ? (
              <>
                <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive-soft p-4">
                  <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
                  <p className="text-sm text-destructive-text">{error}</p>
                </div>
                <Button variant="outline" onClick={() => navigate('/student')}>Back to my tests</Button>
              </>
            ) : (
              <>
                <div>
                  <h1 className="font-display text-2xl font-semibold">{test?.title ?? 'Your test'}</h1>
                  {test && <p className="mt-1 text-sm text-muted-foreground tabular">{test.num_questions} questions · {test.max_marks} marks</p>}
                </div>
                <p className="text-sm text-muted-foreground">
                  The test opens full-screen. For each question, drag the correct option into the answer box (or tap it) and press <strong className="text-foreground">Submit answer</strong>.
                </p>
                <Button size="lg" onClick={start} loading={phase === 'starting'}>
                  <Maximize />{phase === 'starting' ? 'Preparing your paper…' : 'Start test'}
                </Button>
                <Button variant="ghost" onClick={() => navigate('/student')} disabled={phase === 'starting'}>Cancel</Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    )
  }

  // ── test in progress ──────────────────────────────────────
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-4 px-4">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{test?.title ?? 'Test'}</div>
            <div className="text-xs text-muted-foreground tabular">Question {question?.number} of {total}</div>
          </div>
          <Badge variant="accent" className="tabular">{score} / {maxMarks} marks</Badge>
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground tabular" aria-label={`Time elapsed ${mmss}`}>
            <Timer className="size-4" />{mmss}
          </span>
          {integrity.warnings > 0 && (
            <Badge variant={integrity.warnings >= 3 ? 'destructive' : 'warning'} title="Tab switches recorded">
              <ShieldAlert className="size-3" />{integrity.warnings}
            </Badge>
          )}
        </div>
        <Progress value={pct} className="h-1 rounded-none" />
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8">
        {!integrity.isFullscreen && (
          <button onClick={integrity.enterFullscreen}
            className="mb-5 flex w-full items-center justify-center gap-2 rounded-lg border border-warning/30 bg-warning-soft px-4 py-2 text-sm text-warning-text hover:brightness-110 cursor-pointer">
            <Maximize className="size-4" />You left full-screen — click to return
          </button>
        )}

        {question && (
          <div key={question.number} className="animate-fade-up">
            <Card>
              <CardContent className="p-6 sm:p-7">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground tabular">Question {question.number} of {total}</p>
                <h2 className="mt-3 text-lg font-semibold leading-relaxed sm:text-xl">{question.text}</h2>
              </CardContent>
            </Card>
            <div className="mt-5">
              <AnswerBoard
                options={question.options}
                locked={submitting || phase !== 'question'}
                reveal={reveal}
                submitting={submitting}
                keyboardEnabled={phase === 'question' && !integrity.showWarning}
                onSubmit={submit}
              />
            </div>
          </div>
        )}
      </main>

      {/* feedback card after each answer */}
      <Dialog open={!!card} onOpenChange={() => {}}>
        <DialogContent hideClose onEscapeKeyDown={(e) => e.preventDefault()} onPointerDownOutside={(e) => e.preventDefault()}
          onOpenAutoFocus={(e) => { e.preventDefault(); (document.getElementById('fc-next') as HTMLButtonElement | null)?.focus() }}>
          {card && (
            <>
              <DialogHeader>
                <div aria-hidden="true" className={cn('flex items-center gap-2 text-sm font-bold uppercase tracking-wide', card.was_correct ? 'text-success-text' : 'text-destructive-text')}>
                  {card.was_correct ? <CheckCircle2 className="size-5" /> : <XCircle className="size-5" />}
                  {card.was_correct ? 'Correct' : 'Incorrect'}
                </div>
                <DialogTitle className="sr-only">{card.was_correct ? 'Correct' : 'Incorrect'}</DialogTitle>
                <DialogDescription className="sr-only">Correct answer and explanation</DialogDescription>
              </DialogHeader>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Correct answer</p>
              <p className="mt-2 flex items-start gap-3 text-[15px] font-medium">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-success text-xs font-bold text-success-foreground">{card.correct_letter}</span>
                {card.correct_option}
              </p>
              {card.explanation && (
                <>
                  <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Why</p>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{card.explanation}</p>
                </>
              )}
              <DialogFooter>
                <Button id="fc-next" size="lg" onClick={next} className="w-full sm:w-auto">
                  {pending.current?.viva_complete ? 'See my result' : 'Next question'}<ArrowRight />
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* integrity warning */}
      <Dialog open={integrity.showWarning && !card} onOpenChange={(o) => !o && integrity.dismissWarning()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ShieldAlert className="size-5 text-warning" />Stay on the test</DialogTitle>
            <DialogDescription>
              Leaving the test window was recorded — warning <strong className="text-foreground tabular">{Math.min(integrity.warnings, 3)} of 3</strong>.
              {integrity.flagged ? ' This attempt is now flagged for your professor to review.' : ' After three, the attempt is flagged for review.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => { integrity.dismissWarning(); integrity.enterFullscreen() }}>Return to the test</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

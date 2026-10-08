import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { AlertTriangle, ListChecks, Maximize, PenLine, Shuffle, ShieldAlert, Timer } from 'lucide-react'
import { toast } from 'sonner'
import { Brand } from '@/components/Brand'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { useGuide, useTour } from '@/features/guide/guideContext'
import { Elephant } from '@/features/guide/Elephant'
import { exitFullscreen, useIntegrityGuard } from '@/hooks/useIntegrityGuard'
import { apiError } from '@/services/http'
import { studentApi } from '@/services/studentApi'
import { useAppDispatch, useAppSelector } from '@/store'
import { resultSaved } from '@/store/resultsSlice'
import type { AnswerInput, QuestionView, StartTestResponse, StudentTest } from '@/types/api'
import { AnswerBoard } from './AnswerBoard'
import { FillBlankBoard } from './FillBlankBoard'
import { MatchBoard } from './MatchBoard'

type Phase = 'ready' | 'starting' | 'question' | 'finishing' | 'error'

const TYPE_META = {
  mcq: { label: 'Multiple choice', icon: ListChecks, tour: 'test-mcq' },
  fill_blank: { label: 'Fill in the blank', icon: PenLine, tour: 'test-fill' },
  match: { label: 'Match the following', icon: Shuffle, tour: 'test-match' },
} as const

const CHEERS = ['Saved!', 'Got it!', 'Nice going!', 'Saved — keep it up!', 'On to the next one!']

// Older backends only sent first_question_text + options
const viewOf = (r: StartTestResponse): QuestionView =>
  r.question ?? { type: 'mcq', question: r.first_question_text, options: r.options }

export default function TakeTestPage() {
  const { eventId = '' } = useParams()
  const [params] = useSearchParams()
  const uploadId = params.get('upload') ?? ''
  const test = (useLocation().state as { test?: StudentTest } | null)?.test
  const student = useAppSelector((s) => s.auth.student)!
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const guide = useGuide()

  const [phase, setPhase] = useState<Phase>('ready')
  const [error, setError] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [question, setQuestion] = useState<QuestionView | null>(null)
  const [number, setNumber] = useState(1)
  const [total, setTotal] = useState(test?.num_questions ?? 0)
  const [submitting, setSubmitting] = useState(false)
  const [elapsed, setElapsed] = useState(0)

  const integrity = useIntegrityGuard(sessionId)
  const inProgress = phase === 'question'

  // Ellie: the intro tour before starting, then a short tour the first time each question type appears
  useTour(question ? TYPE_META[question.type].tour : 'test-intro', phase === 'ready' || phase === 'question')

  useEffect(() => {
    if (!inProgress) return
    const t = window.setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => window.clearInterval(t)
  }, [inProgress])

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
      setNumber(r.question_number)
      setQuestion(viewOf(r))
      setPhase('question')
      guide.say('Let’s go! You’ve got this.', 'cheer', 2200)
    } catch (e) {
      exitFullscreen()
      setError(apiError(e))
      setPhase('error')
    }
  }

  async function submit(input: AnswerInput) {
    if (!sessionId || submitting) return
    setSubmitting(true)
    try {
      const r = await studentApi.answer(sessionId, input)
      if (r.viva_complete) {
        setPhase('finishing')
        dispatch(resultSaved({ eventId, result: r, title: test?.title }))
        exitFullscreen()
        window.setTimeout(() => navigate(`/student/result/${eventId}?upload=${encodeURIComponent(uploadId)}`, { replace: true }), 1800)
        return
      }
      const left = r.total_questions - r.question_number + 1
      guide.say(`${CHEERS[r.answered % CHEERS.length]} ${left} to go.`, 'talk', 1800)
      setQuestion(r.question)
      setNumber(r.question_number)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (e) {
      toast.error('Answer not saved', { description: apiError(e) })
    } finally {
      setSubmitting(false)
    }
  }

  const pct = total ? ((number - 1) / total) * 100 : 0
  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`

  // ── finished: Ellie celebrates while the result loads ───────
  if (phase === 'finishing') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center" role="status">
        <Elephant mood="cheer" size={150} className="ellie-pop" />
        <h1 className="font-display text-3xl font-semibold">All done!</h1>
        <p className="text-muted-foreground">Ellie is adding up your answers…</p>
      </div>
    )
  }

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
                <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
                  <li>• The test opens full-screen.</li>
                  <li>• Questions can be multiple choice, fill in the blank, or match the following.</li>
                  <li>• <span className="font-semibold text-foreground">Your score and the answers appear only at the end</span>, after the last question.</li>
                </ul>
                <Button size="lg" onClick={start} loading={phase === 'starting'} data-tour="test-start">
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

  const meta = question ? TYPE_META[question.type] : TYPE_META.mcq
  const TypeIcon = meta.icon

  // ── test in progress ──────────────────────────────────────
  return (
    <div className="min-h-screen pb-24">
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-4 px-4">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{test?.title ?? 'Test'}</div>
            <div className="text-xs text-muted-foreground tabular">Question {number} of {total}</div>
          </div>
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground tabular" aria-label={`Time elapsed ${mmss}`}>
            <Timer className="size-4" />{mmss}
          </span>
          {integrity.warnings > 0 && (
            <Badge variant={integrity.warnings >= 3 ? 'destructive' : 'warning'} title="Tab switches recorded">
              <ShieldAlert className="size-3" />{integrity.warnings}
            </Badge>
          )}
        </div>
        <Progress value={pct} className="h-1 rounded-none" aria-label="Test progress" />
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8">
        {!integrity.isFullscreen && (
          <button onClick={integrity.enterFullscreen}
            className="mb-5 flex w-full items-center justify-center gap-2 rounded-lg border border-warning/30 bg-warning-soft px-4 py-2 text-sm text-warning-text hover:brightness-110 cursor-pointer">
            <Maximize className="size-4" />You left full-screen — click to return
          </button>
        )}

        {question && (
          <div key={number} className="animate-fade-up">
            <Card data-tour="question-card">
              <CardContent className="p-6 sm:p-7">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground tabular">Question {number} of {total}</p>
                  <Badge variant="accent"><TypeIcon className="size-3" />{meta.label}</Badge>
                </div>
                {question.type !== 'fill_blank' && (
                  <h2 className="mt-3 text-lg font-semibold leading-relaxed sm:text-xl">{question.question}</h2>
                )}
                {question.type === 'fill_blank' && (
                  <h2 className="mt-3 text-base font-semibold text-muted-foreground">Complete the sentence:</h2>
                )}
              </CardContent>
            </Card>
            <div className="mt-5">
              {question.type === 'mcq' && (
                <AnswerBoard options={question.options} locked={submitting} reveal={null} submitting={submitting}
                  keyboardEnabled={!integrity.showWarning && !guide.touring}
                  onSubmit={(i) => submit({ answer_text: String.fromCharCode(65 + i) })} />
              )}
              {question.type === 'fill_blank' && (
                <FillBlankBoard question={question.question} locked={submitting} submitting={submitting}
                  onSubmit={(text) => submit({ answer_text: text })} />
              )}
              {question.type === 'match' && (
                <MatchBoard left={question.left} right={question.right} locked={submitting} submitting={submitting}
                  onSubmit={(picks) => submit({ match: picks })} />
              )}
            </div>
          </div>
        )}
      </main>

      {/* integrity warning */}
      <Dialog open={integrity.showWarning} onOpenChange={(o) => !o && integrity.dismissWarning()}>
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

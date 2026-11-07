import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { AlertTriangle, BookOpen, GraduationCap, ListChecks, Loader2, Maximize, PenLine, Shuffle, ShieldAlert, Timer } from 'lucide-react'
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
import type { AnswerInput, FinalResult, FlashcardDeck as Deck, QuestionLogEntry, QuestionView, StartTestResponse, StudentTest } from '@/types/api'
import { AnswerBoard } from './AnswerBoard'
import { AnswerFeedback } from './AnswerFeedback'
import { FlashcardDeck } from './FlashcardDeck'
import { FillBlankBoard } from './FillBlankBoard'
import { MatchBoard } from './MatchBoard'

type Phase = 'ready' | 'study' | 'starting' | 'question' | 'finishing' | 'error'

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
  // Guided tests: the study deck, and the marked answer shown before moving on
  const [guided, setGuided] = useState(test?.mode === 'guided')
  const [deck, setDeck] = useState<Deck | null>(null)
  const [deckOpen, setDeckOpen] = useState(false)
  const [review, setReview] = useState<QuestionLogEntry | null>(null)
  const [upNext, setUpNext] = useState<{ question: QuestionView; number: number } | null>(null)
  const [finalResult, setFinalResult] = useState<FinalResult | null>(null)

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

  // Load the flashcards once a guided test is opened; keep checking while they're being written
  useEffect(() => {
    if (!guided || !eventId) return
    let stop = false, timer = 0
    const load = async () => {
      try {
        const d = await studentApi.flashcards(eventId, student.id)
        if (stop) return
        setDeck(d)
        if (d.status === 'generating') timer = window.setTimeout(load, 5000)
      } catch { if (!stop) setDeck({ status: 'failed', cards: [] }) }
    }
    load()
    return () => { stop = true; window.clearTimeout(timer) }
  }, [guided, eventId, student.id])

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
      if (r.mode) setGuided(r.mode === 'guided')
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
        dispatch(resultSaved({ eventId, result: r, title: test?.title }))
        if (r.review) {                       // guided: show the last answer before the result
          setReview(r.review); setFinalResult(r)
          sayVerdict(r.review)
          return
        }
        finish()
        return
      }
      if (r.review) {                         // guided: show how it was marked, then move on
        setReview(r.review)
        setUpNext({ question: r.question, number: r.question_number })
        sayVerdict(r.review)
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

  function finish() {
    setPhase('finishing')
    exitFullscreen()
    window.setTimeout(() => navigate(`/student/result/${eventId}?upload=${encodeURIComponent(uploadId)}`, { replace: true }), 1800)
  }

  function sayVerdict(q: QuestionLogEntry) {
    if (q.is_correct) guide.say('Correct! Well done.', 'cheer', 2000)
    else guide.say('Not quite. Have a look at why.', 'talk', 2200)
  }

  function next() {
    setReview(null)
    if (finalResult) { finish(); return }
    if (upNext) {
      setQuestion(upNext.question)
      setNumber(upNext.number)
      setUpNext(null)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  const reviewing = review !== null
  const pct = total ? ((number - 1 + (reviewing ? 1 : 0)) / total) * 100 : 0
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

  // ── guided: study the flashcards before starting ──────────
  if (phase === 'study') {
    return (
      <div className="min-h-screen px-4 py-10">
        <div className="mx-auto flex max-w-2xl flex-col gap-6 animate-fade-up">
          <div className="flex items-center justify-between gap-3">
            <Brand />
            <Button variant="ghost" size="sm" onClick={() => setPhase('ready')}>Back</Button>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-accent">Guided test · Study first</p>
            <h1 className="mt-1 font-display text-2xl font-semibold">{test?.title ?? 'Flashcards'}</h1>
            <p className="mt-1 text-sm text-muted-foreground">Read each card, flip it to check the answer, and start the test when you feel ready.</p>
          </div>
          <DeckView deck={deck} keyboardEnabled />
          <Button size="lg" onClick={start} data-tour="test-start"><Maximize />I’m ready, start the test</Button>
        </div>
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
                {guided ? (
                  <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
                    <li className="flex items-center gap-2 font-semibold text-accent"><GraduationCap className="size-4" />Guided test</li>
                    <li>• Study the flashcards first. They cover the ideas in this test.</li>
                    <li>• The test opens full-screen.</li>
                    <li>• <span className="font-semibold text-foreground">After every question you’ll see if you were right</span>, the correct answer and why.</li>
                  </ul>
                ) : (
                  <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
                    <li>• The test opens full-screen.</li>
                    <li>• Questions can be multiple choice, fill in the blank, or match the following.</li>
                    <li>• <span className="font-semibold text-foreground">Your score and the answers appear only at the end</span>, after the last question.</li>
                  </ul>
                )}
                {guided && (
                  <Button size="lg" onClick={() => setPhase('study')} disabled={phase === 'starting'}>
                    <BookOpen />Study the flashcards
                  </Button>
                )}
                <Button size="lg" variant={guided ? 'outline' : 'default'} onClick={start} loading={phase === 'starting'} data-tour="test-start">
                  <Maximize />{phase === 'starting' ? 'Preparing your paper…' : guided ? 'Skip to the test' : 'Start test'}
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
      <header className="sticky top-0 z-30 brand-bar shadow-[0_6px_20px_rgb(90_79_192/0.25)]">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-4 px-4">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{test?.title ?? 'Test'}</div>
            <div className="text-xs text-muted-foreground tabular">Question {number} of {total}</div>
          </div>
          {guided && (
            <Button size="sm" variant="ghost" onClick={() => setDeckOpen(true)} aria-label="Open the flashcards">
              <BookOpen /><span className="hidden sm:inline">Flashcards</span>
            </Button>
          )}
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
                <AnswerBoard options={question.options} locked={submitting || reviewing} submitting={submitting}
                  reveal={review && review.correct_index != null ? { correct: review.correct_index, chosen: review.selected_index ?? -1 } : null}
                  keyboardEnabled={!integrity.showWarning && !guide.touring && !reviewing && !deckOpen}
                  onSubmit={(i) => submit({ answer_text: String.fromCharCode(65 + i) })} />
              )}
              {question.type === 'fill_blank' && (
                <FillBlankBoard question={question.question} locked={submitting || reviewing} submitting={submitting}
                  onSubmit={(text) => submit({ answer_text: text })} />
              )}
              {question.type === 'match' && (
                <MatchBoard left={question.left} right={question.right} locked={submitting || reviewing} submitting={submitting}
                  onSubmit={(picks) => submit({ match: picks })} />
              )}
            </div>
            {review && <AnswerFeedback review={review} last={!!finalResult} onNext={next} />}
          </div>
        )}
      </main>

      {/* guided: flashcards stay available during the test */}
      <Dialog open={deckOpen} onOpenChange={setDeckOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><BookOpen className="size-5 text-accent" />Flashcards</DialogTitle>
            <DialogDescription>Revise any time. Your place in the test is kept.</DialogDescription>
          </DialogHeader>
          <DeckView deck={deck} keyboardEnabled={deckOpen} />
        </DialogContent>
      </Dialog>

      {/* integrity warning */}
      <Dialog open={integrity.showWarning} onOpenChange={(o) => !o && integrity.dismissWarning()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ShieldAlert className="size-5 text-warning" />Stay on the test</DialogTitle>
            <DialogDescription>
              Leaving the test window was recorded — warning <strong className="text-foreground tabular">{Math.min(integrity.warnings, 3)} of 3</strong>.
              {integrity.flagged ? ' This attempt is now flagged for your teacher to review.' : ' After three, the attempt is flagged for review.'}
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

function DeckView({ deck, keyboardEnabled }: { deck: Deck | null; keyboardEnabled: boolean }) {
  if (deck?.cards.length) {
    return (
      <div className="flex flex-col gap-2">
        <FlashcardDeck cards={deck.cards} keyboardEnabled={keyboardEnabled} />
        {deck.status === 'generating' && <p className="text-center text-xs text-muted-foreground">More cards are still being written…</p>}
      </div>
    )
  }
  if (!deck || deck.status === 'generating') {
    return (
      <Card><CardContent className="flex flex-col items-center gap-3 p-10 text-center" role="status">
        <Loader2 className="size-6 animate-spin text-accent" />
        <p className="font-semibold">Ellie is writing your flashcards…</p>
        <p className="text-sm text-muted-foreground">This can take a minute or two the first time. You can also start the test now.</p>
      </CardContent></Card>
    )
  }
  return (
    <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">
      Flashcards couldn’t be prepared for this test. You can still take it, and you’ll see the answer after every question.
    </CardContent></Card>
  )
}

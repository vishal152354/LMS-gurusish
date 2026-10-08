import { useCallback, useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import moment from 'moment'
import { Link } from 'react-router'
import { BarChart3, CalendarDays, Check, ListChecks, Minus, PenLine, Plus, Shuffle, Sparkles, Trash2, Users } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/PageHeader'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { GEN_STEPS, generationLabel, useGenerationProgress } from '@/hooks/useGenerationProgress'
import { useTour } from '@/features/guide/guideContext'
import { cn, uuid } from '@/lib/utils'
import { apiError } from '@/services/http'
import { professorApi } from '@/services/professorApi'
import type { ContentItem, EventSummary, QuestionType } from '@/types/api'

const count = z.coerce.number().int().min(0).max(30)
const schema = z.object({
  title: z.string().trim().min(3, 'Give the test a title').max(120),
  upload_id: z.string().min(1, 'Choose the content to test on'),
  types: z.object({ mcq: count, fill_blank: count, match: count })
    .refine((t) => t.mcq + t.fill_blank + t.match >= 1, 'Choose at least one question')
    .refine((t) => t.mcq + t.fill_blank + t.match <= 50, 'At most 50 questions in total'),
  marks_per_question: z.coerce.number().int('Whole numbers only').min(1, 'At least 1').max(100, 'At most 100'),
  event_date: z.date(),
})

const TYPE_CARDS: { key: QuestionType; label: string; hint: string; icon: typeof ListChecks }[] = [
  { key: 'mcq', label: 'Multiple choice', hint: 'Pick the right option', icon: ListChecks },
  { key: 'fill_blank', label: 'Fill in the blanks', hint: 'Type the missing term', icon: PenLine },
  { key: 'match', label: 'Match the following', hint: 'Pair 4 items correctly', icon: Shuffle },
]
const SHORT: Record<QuestionType, string> = { mcq: 'MCQ', fill_blank: 'fill-in', match: 'match' }
type FormValues = z.infer<typeof schema>

export default function EventsPage() {
  const [events, setEvents] = useState<EventSummary[] | null>(null)
  useTour('prof-events', events !== null)
  const [content, setContent] = useState<ContentItem[]>([])
  const [toDelete, setToDelete] = useState<EventSummary | null>(null)

  const load = useCallback(async () => {
    try {
      const [ev, c] = await Promise.all([professorApi.listEvents(), professorApi.listContent()])
      setEvents(ev); setContent(c)
    } catch (e) { toast.error(apiError(e)) }
  }, [])
  useEffect(() => { load() }, [load])

  async function remove(ev: EventSummary) {
    try {
      await professorApi.deleteEvent(ev.event_id)
      setEvents((xs) => xs?.filter((x) => x.event_id !== ev.event_id) ?? null)
      toast.success('Event deleted')
    } catch (e) { toast.error(apiError(e)) }
  }

  return (
    <div className="animate-fade-up">
      <PageHeader title="Events" description="Create a test from your content. The question paper is generated once, now, so every student gets the same paper." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_1fr]">
        <CreateEventCard content={content.filter((c) => c.okf_ready)} onCreated={load} />

        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Your events</h2>
          <div className="flex flex-col gap-3">
            {!events && [0, 1, 2].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
            {events?.length === 0 && <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">No events yet. Create your first test on the left.</CardContent></Card>}
            {events?.map((ev) => (
              <Card key={ev.event_id} className="transition-colors hover:border-border-strong">
                <CardContent className="flex flex-col gap-3 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-lg font-semibold">{ev.title}</h3>
                      <p className="truncate text-sm text-muted-foreground">
                        {ev.num_questions} questions · {ev.num_questions * ev.marks_per_question} marks · {ev.content_name}
                      </p>
                      {ev.question_types && (
                        <p className="mt-0.5 text-xs text-subtle-foreground">
                          {(Object.keys(SHORT) as QuestionType[]).filter((k) => ev.question_types![k]).map((k) => `${ev.question_types![k]} ${SHORT[k]}`).join(' · ')}
                        </p>
                      )}
                    </div>
                    <Button size="icon" variant="ghost" className="hover:text-destructive-text" onClick={() => setToDelete(ev)} aria-label={`Delete ${ev.title}`}><Trash2 /></Button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge><CalendarDays className="size-3" />{moment(ev.event_date).format('D MMM YYYY')}</Badge>
                    <Badge variant={ev.roster_count ? 'accent' : 'warning'}><Users className="size-3" />{ev.roster_count} in roster</Badge>
                    <Badge variant={ev.completed ? 'success' : 'default'}><Check className="size-3" />{ev.completed} completed</Badge>
                    <div className="ml-auto flex gap-1">
                      <Button asChild size="sm" variant="ghost"><Link to={`/professor/roster?event=${ev.event_id}`}><Users />Roster</Link></Button>
                      <Button asChild size="sm" variant="ghost"><Link to={`/professor/results?event=${ev.event_id}`}><BarChart3 />Results</Link></Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      </div>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogTitle>Delete “{toDelete?.title}”?</AlertDialogTitle>
          <AlertDialogDescription>Its roster, question paper and all student results are removed. This can’t be undone.</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => toDelete && remove(toDelete)}>Delete event</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function CreateEventCard({ content, onCreated }: { content: ContentItem[]; onCreated: () => void }) {
  const [progressId, setProgressId] = useState<string | null>(null)
  const [visible, setVisible] = useState(false)
  const progress = useGenerationProgress(progressId)
  const form = useForm<z.input<typeof schema>, unknown, FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { title: '', upload_id: '', types: { mcq: 5, fill_blank: 3, match: 2 }, marks_per_question: 1, event_date: new Date() },
  })
  const types = form.watch('types')
  const n = (Number(types.mcq) || 0) + (Number(types.fill_blank) || 0) + (Number(types.match) || 0)
  const m = Number(form.watch('marks_per_question')) || 0
  const busy = form.formState.isSubmitting

  async function onSubmit(v: FormValues) {
    const pid = uuid()
    setProgressId(pid); setVisible(true)
    try {
      const r = await professorApi.createEvent({
        upload_id: v.upload_id, title: v.title, question_types: v.types,
        marks_per_question: v.marks_per_question, event_date: moment(v.event_date).format('YYYY-MM-DD'), progress_id: pid,
      })
      progress.finish()
      const short = (Object.keys(SHORT) as QuestionType[]).filter((k) => r.requested[k] > r.question_types[k])
      if (short.length) {
        toast.warning('Test created with fewer questions', {
          description: `The AI could only write ${short.map((k) => `${r.question_types[k]} of ${r.requested[k]} ${SHORT[k]}`).join(', ')} from this content.`,
        })
      } else {
        toast.success('Test created', { description: `${r.num_questions} questions, ${r.total_marks} marks. Add a roster to assign students.` })
      }
      form.reset({ ...v, title: '' })
      onCreated()
      window.setTimeout(() => setVisible(false), 2500)
    } catch (e) {
      progress.fail()
      toast.error('Could not create the test', { description: apiError(e) })
    }
  }

  const activeIdx = GEN_STEPS.findIndex((s) => s.stage === progress.stage)

  return (
    <Card className="h-fit lg:sticky lg:top-36" data-tour="event-form">
      <CardHeader><CardTitle className="flex items-center gap-2"><Sparkles className="size-4 text-accent" />Create a test</CardTitle></CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
            <FormField control={form.control} name="title" render={({ field }) => (
              <FormItem><FormLabel>Title</FormLabel><FormControl><Input placeholder="e.g. Unit 2 — Ohm’s law" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="upload_id" render={({ field }) => (
              <FormItem>
                <FormLabel>Content</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl><SelectTrigger><SelectValue placeholder={content.length ? 'Choose content' : 'No ready content yet'} /></SelectTrigger></FormControl>
                  <SelectContent>{content.map((c) => <SelectItem key={c.upload_id} value={c.upload_id}>{c.display_name}</SelectItem>)}</SelectContent>
                </Select>
                {!content.length && <FormDescription>Upload a document on the Content tab and wait for it to show Ready.</FormDescription>}
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="types" render={({ field }) => (
              <FormItem data-tour="question-types">
                <FormLabel>Question types</FormLabel>
                <div className="flex flex-col gap-2">
                  {TYPE_CARDS.map(({ key, label, hint, icon: Icon }) => {
                    const value = Number(field.value[key]) || 0
                    const set = (v: number) => field.onChange({ ...field.value, [key]: Math.max(0, Math.min(30, v)) })
                    return (
                      <div key={key} className={cn('flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors',
                        value ? 'border-accent/50 bg-accent-soft/50' : 'border-border bg-muted')}>
                        <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', value ? 'bg-accent text-accent-foreground' : 'bg-card-strong text-muted-foreground')}>
                          <Icon className="size-4" />
                        </span>
                        <div className="min-w-0 flex-1 leading-tight">
                          <div className="text-sm font-semibold">{label}</div>
                          <div className="text-xs text-muted-foreground">{hint}</div>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button type="button" size="icon" variant="ghost" className="size-8" onClick={() => set(value - 1)} disabled={value === 0} aria-label={`Fewer ${label}`}><Minus /></Button>
                          <input value={value} inputMode="numeric" aria-label={`Number of ${label} questions`}
                            onChange={(e) => set(Number(e.target.value.replace(/\D/g, '')) || 0)}
                            className="w-9 rounded-md border border-input bg-background/40 py-1 text-center text-sm font-semibold tabular outline-none focus:border-accent" />
                          <Button type="button" size="icon" variant="ghost" className="size-8" onClick={() => set(value + 1)} disabled={value >= 30} aria-label={`More ${label}`}><Plus /></Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="marks_per_question" render={({ field }) => (
              <FormItem><FormLabel>Marks per question</FormLabel><FormControl><Input type="number" min={1} max={100} inputMode="numeric" {...field} value={field.value as number} /></FormControl>
                <FormDescription>Match questions give partial marks for each correct pair.</FormDescription><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="event_date" render={({ field }) => (
              <FormItem>
                <FormLabel>Test date</FormLabel>
                <Popover>
                  <PopoverTrigger asChild>
                    <FormControl>
                      <Button type="button" variant="outline" className="h-10 justify-start rounded-md font-normal">
                        <CalendarDays className="text-muted-foreground" />{moment(field.value).format('ddd, D MMM YYYY')}
                      </Button>
                    </FormControl>
                  </PopoverTrigger>
                  <PopoverContent><Calendar mode="single" selected={field.value} onSelect={(d) => d && field.onChange(d)} disabled={{ before: moment().startOf('day').toDate() }} /></PopoverContent>
                </Popover>
                <FormDescription>Rostered students can take the test any time once it’s created.</FormDescription>
              </FormItem>
            )} />
            <div className="flex items-center justify-between rounded-md border border-border bg-muted px-3 py-2.5 text-sm">
              <span className="text-muted-foreground">{n} question{n === 1 ? '' : 's'} · total marks</span>
              <span className="font-semibold tabular">{n * m || '—'}</span>
            </div>

            {visible && (
              <div className="rounded-lg border border-border bg-white/[0.03] p-4" aria-live="polite">
                <div className="mb-2.5 flex justify-between gap-3 text-sm">
                  <span className={cn(progress.stage === 'failed' && 'text-destructive-text', progress.stage === 'done' && 'text-success-text')}>
                    {generationLabel(progress.stage, progress.attempt, n, progress.batches.done, progress.batches.total)}
                  </span>
                  <span className="font-semibold text-muted-foreground tabular">{Math.floor(progress.pct)}%</span>
                </div>
                <Progress value={progress.pct} shimmer={progress.stage !== 'done' && progress.stage !== 'failed'}
                  indicatorClassName={cn(progress.stage === 'done' && 'from-success to-success', progress.stage === 'failed' && 'from-destructive to-destructive')}
                  aria-label="Question generation progress" />
                <ol className="mt-2.5 flex justify-between text-[11px] text-muted-foreground">
                  {GEN_STEPS.map((s, i) => {
                    const complete = progress.stage === 'done' || (activeIdx > i)
                    return (
                      <li key={s.stage} className={cn('flex items-center gap-1', i === activeIdx && 'font-semibold text-accent', complete && 'text-foreground')}>
                        {complete && <Check className="size-3 text-success" />}{s.label}
                      </li>
                    )
                  })}
                </ol>
              </div>
            )}

            <Button type="submit" size="lg" loading={busy} disabled={!content.length} data-tour="create-test">
              {busy ? 'Generating questions…' : 'Create test'}
            </Button>
            <p className="text-xs text-subtle-foreground">Questions are written in parallel batches from the knowledge graph — usually under 30 seconds.</p>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}

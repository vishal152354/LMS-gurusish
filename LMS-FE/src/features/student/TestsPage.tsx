import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { CheckCircle2, Clock, FileText, Maximize, RefreshCw, ShieldAlert, Trophy } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { useTour } from '@/features/guide/guideContext'
import { apiError } from '@/services/http'
import { studentApi } from '@/services/studentApi'
import { useAppSelector } from '@/store'
import type { StudentTest } from '@/types/api'

export default function TestsPage() {
  const student = useAppSelector((s) => s.auth.student)!
  const navigate = useNavigate()
  const [tests, setTests] = useState<StudentTest[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<StudentTest | null>(null)
  useTour('student-tests', tests !== null)

  const load = useCallback(async () => {
    setError(null)
    try { setTests(await studentApi.myTests(student.roll)) } catch (e) { setError(apiError(e)) }
  }, [student.roll])

  useEffect(() => { load() }, [load])

  const pending = tests?.filter((t) => !t.attempted) ?? []
  const done = tests?.filter((t) => t.attempted) ?? []

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 animate-fade-up">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">Hello, {student.name.split(' ')[0]}</p>
          <h1 className="mt-1 font-display text-3xl font-semibold">My tests</h1>
        </div>
        <Button variant="outline" size="sm" onClick={() => { setTests(null); load() }} data-tour="tests-refresh"><RefreshCw />Refresh</Button>
      </div>

      {error && (
        <Card className="mt-8 border-destructive/40">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
            <p className="text-sm text-destructive-text">{error}</p>
            <Button size="sm" variant="outline" onClick={load}>Try again</Button>
          </CardContent>
        </Card>
      )}

      {!tests && !error && (
        <div className="mt-8 grid gap-4 sm:grid-cols-2">{[0, 1].map((i) => <Skeleton key={i} className="h-44 rounded-xl" />)}</div>
      )}

      {tests && tests.length === 0 && (
        <Card className="mt-8">
          <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
            <FileText className="size-8 text-subtle-foreground" />
            <h2 className="text-lg font-semibold">No tests assigned yet</h2>
            <p className="max-w-sm text-sm text-muted-foreground">
              Tests appear here once your professor adds roll number <span className="font-semibold text-foreground tabular">{student.roll}</span> to an event roster.
            </p>
          </CardContent>
        </Card>
      )}

      {pending.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">To do</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {pending.map((t, i) => (
              <div key={t.event_id} data-tour={i === 0 ? 'test-card' : undefined}>
                <TestCard test={t} onStart={() => setConfirm(t)} />
              </div>
            ))}
          </div>
        </section>
      )}

      {done.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Completed</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {done.map((t) => <TestCard key={t.event_id} test={t} />)}
          </div>
        </section>
      )}

      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start “{confirm?.title}”?</DialogTitle>
            <DialogDescription>{confirm?.num_questions} questions · {confirm?.max_marks} marks</DialogDescription>
          </DialogHeader>
          <ul className="flex flex-col gap-3 text-sm">
            <li className="flex gap-3"><Clock className="mt-0.5 size-4 shrink-0 text-accent" /><span>You get <strong>one attempt</strong>. Once you start, finish it in one sitting.</span></li>
            <li className="flex gap-3"><Maximize className="mt-0.5 size-4 shrink-0 text-accent" /><span>The test runs full-screen.</span></li>
            <li className="flex gap-3"><ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" /><span>Switching tabs or windows is logged; three switches flag the attempt for review.</span></li>
          </ul>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(null)}>Not yet</Button>
            <Button
              onClick={() => {
                if (!confirm) return
                if (!confirm.ready) return toast.error('This test is still being prepared.')
                navigate(`/student/test/${confirm.event_id}?upload=${encodeURIComponent(confirm.upload_id)}`, { state: { test: confirm } })
              }}
            >
              I’m ready — start
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}

function TestCard({ test, onStart }: { test: StudentTest; onStart?: () => void }) {
  return (
    <Card className="flex flex-col transition-colors hover:border-border-strong">
      <CardContent className="flex flex-1 flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-lg font-semibold">{test.title}</h3>
            <p className="mt-0.5 truncate text-sm text-muted-foreground">{test.filename}</p>
          </div>
          {test.attempted ? <Badge variant="success"><CheckCircle2 className="size-3" />Done</Badge>
            : test.ready ? <Badge variant="accent">Open</Badge>
            : <Badge variant="warning">Preparing</Badge>}
        </div>
        <div className="flex gap-5 text-sm text-muted-foreground tabular">
          <span>{test.num_questions} questions</span>
          <span>{test.max_marks} marks</span>
        </div>
        <div className="mt-auto flex items-center justify-between gap-3 border-t border-border pt-4">
          {test.attempted ? (
            <>
              <span className="flex items-center gap-2 text-sm">
                <Trophy className="size-4 text-warning" />
                <span className="font-semibold tabular">{test.score ?? 0} / {test.max_marks}</span>
                {test.grade && <span className="text-muted-foreground">· {test.grade}</span>}
              </span>
              <Button asChild variant="outline" size="sm">
                <Link to={`/student/result/${test.event_id}?upload=${encodeURIComponent(test.upload_id)}`}>View result</Link>
              </Button>
            </>
          ) : (
            <Button className="w-full" onClick={onStart} disabled={!test.ready}>{test.ready ? 'Start test' : 'Being prepared…'}</Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

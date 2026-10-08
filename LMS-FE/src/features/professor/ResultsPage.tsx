import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, Download, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { AnswerDonut } from '@/components/AnswerDonut'
import { PageHeader } from '@/components/PageHeader'
import { QuestionReview } from '@/components/QuestionReview'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { useTour } from '@/features/guide/guideContext'
import { apiError } from '@/services/http'
import { professorApi } from '@/services/professorApi'
import { useAppSelector } from '@/store'
import type { ResultRow, ResultStatus } from '@/types/api'
import { EventPicker, useSelectedEvent } from './EventPicker'

const STATUS_BADGE: Record<ResultStatus, 'success' | 'accent' | 'warning' | 'destructive' | 'default'> = {
  Completed: 'success', 'In Progress': 'accent', Pending: 'warning', 'No Show': 'destructive', 'Not Booked': 'default', 'Not Attempted': 'default',
}
const FILTERS: ('All' | ResultStatus)[] = ['All', 'Completed', 'In Progress', 'Not Attempted', 'No Show']

export default function ResultsPage() {
  const token = useAppSelector((s) => s.auth.professor!.token)
  const { events, eventId, select } = useSelectedEvent()
  const [rows, setRows] = useState<ResultRow[] | null>(null)
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('All')
  const [open, setOpen] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  useTour('prof-results', !!rows?.length)

  const load = useCallback(async (quiet = false) => {
    if (!eventId) return
    if (!quiet) setRows(null)
    setRefreshing(true)
    try { setRows((await professorApi.results(eventId)).results) } catch (e) { toast.error(apiError(e)); setRows([]) }
    finally { setRefreshing(false) }
  }, [eventId])
  useEffect(() => { setOpen(null); setFilter('All'); load() }, [load])

  const counts = useMemo(() => {
    const c: Record<string, number> = { All: rows?.length ?? 0 }
    rows?.forEach((r) => { c[r.status] = (c[r.status] ?? 0) + 1 })
    return c
  }, [rows])

  const completed = rows?.filter((r) => r.status === 'Completed') ?? []
  const avgPct = completed.length
    ? Math.round(completed.reduce((s, r) => s + (Number(r.total) / (r.max_marks || 1)) * 100, 0) / completed.length)
    : null
  const shown = rows?.filter((r) => filter === 'All' || r.status === filter) ?? []

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Results"
        description="Click a student’s name to see how they answered."
        actions={eventId && (
          <>
            <Button variant="outline" size="sm" onClick={() => load(true)} loading={refreshing}><RefreshCw />Refresh</Button>
            <Button size="sm" asChild><a href={professorApi.exportUrl(eventId, token)} download data-tour="results-export"><Download />Export Excel</a></Button>
          </>
        )}
      />
      <EventPicker events={events} value={eventId} onChange={select} />

      {eventId && (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="On roster" value={rows ? counts.All : null} />
            <Stat label="Completed" value={rows ? (counts.Completed ?? 0) : null} />
            <Stat label="Not attempted" value={rows ? (counts['Not Attempted'] ?? 0) + (counts['Not Booked'] ?? 0) : null} />
            <Stat label="Average score" value={rows ? (avgPct === null ? '—' : `${avgPct}%`) : null} />
          </div>

          <div className="mt-6 flex flex-wrap gap-2" role="tablist" aria-label="Filter by status">
            {FILTERS.map((f) => (
              <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}
                className={cn('rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer',
                  filter === f ? 'border-transparent bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground')}>
                {f} <span className="tabular opacity-70">({counts[f] ?? 0})</span>
              </button>
            ))}
          </div>

          <Card className="mt-4 overflow-hidden" data-tour="results-table">
            {!rows ? (
              <div className="flex flex-col gap-2 p-5">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}</div>
            ) : shown.length === 0 ? (
              <p className="p-10 text-center text-sm text-muted-foreground">{rows.length ? 'No students match this filter.' : 'No students on this roster yet.'}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Roll no.</TableHead><TableHead>Name</TableHead><TableHead>Status</TableHead>
                    <TableHead className="text-right">Marks</TableHead><TableHead className="text-center">Grade</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((r) => {
                    const isOpen = open === r.roll_number
                    const absent = r.grade === 'Absent' || r.status === 'No Show'
                    return (
                      <Fragment key={r.roll_number}>
                        <TableRow className={cn(isOpen && 'bg-accent-soft/40')}>
                          <TableCell className="font-mono text-xs">{r.roll_number}</TableCell>
                          <TableCell>
                            {r.breakdown ? (
                              <button onClick={() => setOpen(isOpen ? null : r.roll_number)} aria-expanded={isOpen}
                                className="inline-flex items-center gap-1.5 font-semibold text-accent hover:underline underline-offset-4 cursor-pointer">
                                {r.student_name}<ChevronDown className={cn('size-3.5 transition-transform', isOpen && 'rotate-180')} />
                              </button>
                            ) : <span className="font-medium">{r.student_name}</span>}
                          </TableCell>
                          <TableCell><Badge variant={STATUS_BADGE[r.status]}>{r.status}</Badge></TableCell>
                          <TableCell className="text-right tabular">
                            {r.status === 'Completed' ? <><span className="font-semibold">{r.total}</span><span className="text-muted-foreground"> / {r.max_marks}</span></> : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className={cn('text-center font-bold', gradeTone(r, absent))}>
                            {r.grade && r.grade !== '-' ? r.grade : '—'}
                          </TableCell>
                        </TableRow>
                        {isOpen && r.breakdown && (
                          <TableRow className="bg-white/[0.015] hover:bg-white/[0.015]">
                            <TableCell colSpan={5} className="p-0">
                              <div className="grid gap-6 p-6 animate-fade-up md:grid-cols-[minmax(240px,320px)_1fr]">
                                <AnswerDonut correct={r.breakdown.correct} wrong={r.breakdown.wrong} unanswered={r.breakdown.unanswered}
                                  marks={`${r.total} / ${r.max_marks}`} size={140} />
                                <div className="max-h-80 overflow-y-auto pr-1">
                                  {r.breakdown.questions ? (
                                    <QuestionReview items={r.breakdown.questions.map((q) => ({
                                      ...q, marks: q.marks_awarded ?? null, maxMarks: q.max_marks ?? null,
                                    }))} />
                                  ) : (
                                    <p className="text-sm text-muted-foreground">Question-by-question answers weren’t saved for this attempt — it was taken before answer tracking was added.</p>
                                  )}
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </Card>
        </>
      )}
      {events?.length === 0 && <p className="mt-8 text-sm text-muted-foreground">No events yet.</p>}
    </div>
  )
}

// Colour the grade by how well the student did — never green for a failing grade
function gradeTone(r: ResultRow, absent: boolean) {
  if (absent) return 'text-destructive-text'
  if (r.status !== 'Completed' || !r.max_marks) return 'text-muted-foreground'
  const pct = (Number(r.total) / r.max_marks) * 100
  return pct >= 60 ? 'text-success-text' : pct >= 40 ? 'text-warning-text' : 'text-destructive-text'
}

function Stat({ label, value }: { label: string; value: number | string | null }) {
  return (
    <Card>
      <CardContent className="p-4">
        {value === null ? <Skeleton className="h-8 w-12" /> : <div className="text-2xl font-bold tabular">{value}</div>}
        <div className="mt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  )
}

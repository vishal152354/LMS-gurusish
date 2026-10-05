import { useEffect, useMemo, useState } from 'react'
import moment from 'moment'
import { Activity, Radio } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { professorApi } from '@/services/professorApi'
import type { EventSummary, OrchestratorStatus } from '@/types/api'

const POLL_MS = 5000

export default function LivePage() {
  const [status, setStatus] = useState<OrchestratorStatus | null>(null)
  const [events, setEvents] = useState<EventSummary[]>([])
  const [offline, setOffline] = useState(false)
  const [, forceTick] = useState(0)

  useEffect(() => { professorApi.listEvents().then(setEvents).catch(() => {}) }, [])
  useEffect(() => {
    let stop = false
    let t: number
    const poll = async () => {
      try { const s = await professorApi.liveStatus(); if (!stop) { setStatus(s); setOffline(false) } }
      catch { if (!stop) setOffline(true) }
      if (!stop) t = window.setTimeout(poll, document.hidden ? POLL_MS * 3 : POLL_MS)
    }
    poll()
    const clock = window.setInterval(() => forceTick((n) => n + 1), 1000) // refresh "started 2m ago"
    return () => { stop = true; window.clearTimeout(t); window.clearInterval(clock) }
  }, [])

  const byId = useMemo(() => Object.fromEntries(events.map((e) => [e.event_id, e])), [events])
  const sessions = status?.active_sessions ?? []

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Live monitor"
        description="Tests in progress right now. Updates every few seconds."
        actions={<Badge variant={offline ? 'destructive' : 'success'}><Radio className="size-3" />{offline ? 'Offline' : 'Live'}</Badge>}
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Tile label="In progress" value={status?.active_count} />
        <Tile label="Free seats" value={status?.available_slots} />
        <Tile label="Waiting in queue" value={status?.queue_length} />
      </div>

      <Card className="mt-6 overflow-hidden">
        {!status ? (
          <div className="flex flex-col gap-2 p-5">{[0, 1].map((i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-12 text-center">
            <Activity className="size-7 text-subtle-foreground" />
            <p className="font-semibold">No tests in progress</p>
            <p className="text-sm text-muted-foreground">Students appear here as soon as they start a test.</p>
          </div>
        ) : (
          <Table>
            <TableHeader><TableRow><TableHead>Student</TableHead><TableHead>Test</TableHead><TableHead className="w-56">Progress</TableHead><TableHead className="text-right">Score</TableHead><TableHead>Started</TableHead></TableRow></TableHeader>
            <TableBody>
              {sessions.map((s) => {
                const ev = byId[s.event_id]
                const total = ev?.num_questions ?? 10
                const done = Math.max(0, Math.min(total, s.question_number))
                return (
                  <TableRow key={s.session_id}>
                    <TableCell><div className="font-semibold">{s.student_name}</div><div className="font-mono text-xs text-muted-foreground">{s.roll_number}</div></TableCell>
                    <TableCell className="text-muted-foreground">{ev?.title ?? '—'}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3"><Progress value={(done / total) * 100} className="flex-1" /><span className="text-xs text-muted-foreground tabular">{done}/{total}</span></div>
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular">{s.score_so_far}</TableCell>
                    <TableCell className="text-muted-foreground">{moment(s.started_at).fromNow()}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  )
}

function Tile({ label, value }: { label: string; value?: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        {value === undefined ? <Skeleton className="h-8 w-10" /> : <div className="text-2xl font-bold tabular">{value}</div>}
        <div className="mt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import moment from 'moment'
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { BarChart3, ChevronRight, Search } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { adminApi } from '@/services/adminApi'
import { apiError } from '@/services/http'
import type { AdminTest } from '@/types/api'

const BAND = (pct: number) => (pct >= 60 ? '#0f9f8f' : pct >= 40 ? '#e8890c' : '#e5484d')
const ALL = '__all__'
const tone = (pct: number | null) =>
  pct === null ? 'font-normal text-muted-foreground' : pct >= 60 ? 'text-success-text' : pct >= 40 ? 'text-warning-text' : 'text-destructive-text'

export default function ResultsListPage() {
  const [tests, setTests] = useState<AdminTest[] | null>(null)
  const [query, setQuery] = useState('')
  const [teacher, setTeacher] = useState(ALL)

  useEffect(() => {
    adminApi.listTests().then(setTests).catch((e) => { toast.error(apiError(e)); setTests([]) })
  }, [])

  const teachers = useMemo(() => [...new Set((tests ?? []).map((t) => t.teacher_name))].sort(), [tests])
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (tests ?? []).filter((t) =>
      (teacher === ALL || t.teacher_name === teacher) &&
      (!q || t.title.toLowerCase().includes(q) || t.content_name.toLowerCase().includes(q)))
  }, [tests, query, teacher])

  const attempted = shown.filter((t) => t.average_pct !== null)
  const attempts = shown.reduce((s, t) => s + t.completed, 0)
  // overall average weights each test by its number of attempts
  const overall = attempts
    ? Math.round(attempted.reduce((s, t) => s + (t.average_pct ?? 0) * t.completed, 0) / attempts)
    : null

  return (
    <div className="animate-fade-up">
      <PageHeader title="Test results" description="Every teacher’s tests. Open a test to see each student’s marks, the class chart and the answers." />

      <div className="flex flex-wrap gap-3">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tests or content" className="pl-9" aria-label="Search tests" />
        </div>
        <Select value={teacher} onValueChange={setTeacher}>
          <SelectTrigger className="w-56" aria-label="Filter by teacher"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All teachers</SelectItem>
            {teachers.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {attempted.length > 0 && (
        <Card className="mt-6">
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2"><BarChart3 className="size-4 text-accent" />Average score by test</CardTitle>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-accent px-3 py-1 font-semibold text-accent-foreground">
                <span className="opacity-85">Overall average</span> <span className="tabular">{overall}%</span>
              </span>
              <span className="rounded-full border border-border bg-muted px-3 py-1">
                <span className="text-muted-foreground">Attempts</span> <span className="font-semibold tabular">{attempts}</span>
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <div style={{ minWidth: Math.max(320, attempted.length * 72) }} className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={attempted} margin={{ top: 24, right: 12, bottom: 4, left: -16 }} barCategoryGap="24%">
                    <CartesianGrid vertical={false} stroke="var(--color-border)" />
                    <XAxis dataKey="title" tickLine={false} interval={0} axisLine={{ stroke: 'var(--color-border-strong)' }}
                      tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }}
                      tickFormatter={(v: string) => (v.length > 12 ? `${v.slice(0, 11)}…` : v)} />
                    <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v) => `${v}%`} tickLine={false} axisLine={false}
                      tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }} />
                    <Tooltip cursor={{ fill: 'rgb(108 93 211 / 0.06)' }}
                      content={({ active, payload }) => {
                        const t = active && (payload?.[0]?.payload as AdminTest | undefined)
                        return t ? (
                          <div className="rounded-md border border-border-strong bg-popover px-3 py-2 text-xs shadow-lg">
                            <div className="font-semibold">{t.title}</div>
                            <div className="text-muted-foreground tabular">{t.teacher_name} · {t.completed} attempt{t.completed === 1 ? '' : 's'} · average {t.average_pct}%</div>
                          </div>
                        ) : null
                      }} />
                    <Bar dataKey="average_pct" radius={[6, 6, 0, 0]} maxBarSize={44} animationDuration={600}>
                      {attempted.map((t) => <Cell key={t.event_id} fill={BAND(t.average_pct ?? 0)} />)}
                    </Bar>
                    {overall !== null && (
                      <ReferenceLine y={overall} stroke="var(--color-accent)" strokeWidth={2} strokeDasharray="6 4"
                        label={{ value: `Overall ${overall}%`, position: 'insideTopRight', fill: 'var(--color-accent)', fontSize: 11, fontWeight: 700 }} />
                    )}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="mt-6 overflow-hidden">
        {!tests ? (
          <div className="flex flex-col gap-2 p-5">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : shown.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">{tests.length ? 'No tests match.' : 'No tests have been created yet.'}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Test</TableHead><TableHead>Teacher</TableHead>
                <TableHead className="hidden md:table-cell">Date</TableHead>
                <TableHead className="text-right">Marks</TableHead>
                <TableHead className="text-right">Completed</TableHead>
                <TableHead className="text-right">Average</TableHead><TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((t) => (
                <TableRow key={t.event_id} className="group">
                  <TableCell>
                    <Link to={t.event_id} className="font-semibold text-accent hover:underline underline-offset-4">{t.title}</Link>
                    <div className="max-w-64 truncate text-xs text-muted-foreground">{t.content_name} · {t.num_questions} questions</div>
                  </TableCell>
                  <TableCell>{t.teacher_name}</TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">{moment(t.event_date).format('D MMM YYYY')}</TableCell>
                  <TableCell className="text-right tabular">{t.total_marks}</TableCell>
                  <TableCell className="text-right tabular">{t.completed}<span className="text-muted-foreground"> / {t.roster_count}</span></TableCell>
                  <TableCell className={cn('text-right font-semibold tabular', tone(t.average_pct))}>
                    {t.average_pct === null ? '—' : `${t.average_pct}%`}
                  </TableCell>
                  <TableCell>
                    <Link to={t.event_id} aria-label={`Open results for ${t.title}`} className="flex text-muted-foreground group-hover:text-accent"><ChevronRight className="size-4" /></Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  )
}

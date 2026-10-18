import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { TrendingUp } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { ResultRow } from '@/types/api'

// Same bands as the grade colours in the results table
const BAND = { good: '#0f9f8f', fair: '#e8890c', low: '#e5484d' } as const
const band = (pct: number) => (pct >= 60 ? 'good' : pct >= 40 ? 'fair' : 'low')
const BAR_W = 44          // px per student before the chart starts scrolling sideways

/** Every student's score as a bar, with the class average drawn across. */
export function ClassChart({ rows }: { rows: ResultRow[] }) {
  const data = rows
    .filter((r) => r.status === 'Completed' && r.max_marks)
    .map((r) => {
      const raw = (Number(r.total) / r.max_marks) * 100
      return { roll: r.roll_number, name: r.student_name, first: r.student_name.split(' ')[0], raw, pct: Math.round(raw), marks: `${r.total} / ${r.max_marks}` }
    })
    .sort((a, b) => b.pct - a.pct)

  if (data.length === 0) return null
  // average the unrounded scores, so it matches the Average score card
  const avg = Math.round(data.reduce((s, d) => s + d.raw, 0) / data.length)
  const top = data[0]
  const low = data[data.length - 1]
  const passed = data.filter((d) => d.raw >= 40).length

  return (
    <Card className="mt-6" data-tour="class-chart">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2"><TrendingUp className="size-4 text-accent" />Class performance</CardTitle>
        <div className="flex flex-wrap gap-2 text-xs">
          <Chip label="Class average" value={`${avg}%`} strong />
          <Chip label="Highest" value={`${top.pct}% · ${top.first}`} />
          {data.length > 1 && <Chip label="Lowest" value={`${low.pct}% · ${low.first}`} />}
          <Chip label="Scored 40%+" value={`${passed} of ${data.length}`} />
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <div style={{ minWidth: Math.max(320, data.length * BAR_W) }} className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 24, right: 12, bottom: 4, left: -16 }} barCategoryGap="22%">
                <CartesianGrid vertical={false} stroke="var(--color-border)" />
                <XAxis dataKey="first" tickLine={false} axisLine={{ stroke: 'var(--color-border-strong)' }} interval={0}
                  tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }} />
                <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v) => `${v}%`} tickLine={false} axisLine={false}
                  tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }} />
                <Tooltip
                  cursor={{ fill: 'rgb(108 93 211 / 0.06)' }}
                  content={({ active, payload }) => {
                    const d = active && payload?.[0]?.payload as (typeof data)[number] | undefined
                    return d ? (
                      <div className="rounded-md border border-border-strong bg-popover px-3 py-2 text-xs shadow-lg">
                        <div className="font-semibold">{d.name}</div>
                        <div className="text-muted-foreground tabular">{d.roll} · {d.marks} marks · {d.pct}%</div>
                      </div>
                    ) : null
                  }}
                />
                <Bar dataKey="pct" radius={[6, 6, 0, 0]} maxBarSize={40} animationDuration={600}>
                  {data.map((d) => <Cell key={d.roll} fill={BAND[band(d.pct)]} />)}
                </Bar>
                <ReferenceLine y={avg} stroke="var(--color-accent)" strokeWidth={2} strokeDasharray="6 4" ifOverflow="extendDomain"
                  label={{ value: `Class average ${avg}%`, position: 'insideTopRight', fill: 'var(--color-accent)', fontSize: 11, fontWeight: 700 }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <ul className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground" aria-label="Colour key">
          <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: BAND.good }} />60% and above</li>
          <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: BAND.fair }} />40–59%</li>
          <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: BAND.low }} />Below 40%</li>
          <li className="flex items-center gap-1.5"><span className="h-0 w-4 border-t-2 border-dashed border-accent" />Class average</li>
        </ul>
        <p className="sr-only">
          {`Class average ${avg}%. ` + data.map((d) => `${d.name}: ${d.pct}%`).join(', ')}
        </p>
      </CardContent>
    </Card>
  )
}

function Chip({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <span className={strong ? 'rounded-full bg-accent px-3 py-1 font-semibold text-accent-foreground' : 'rounded-full border border-border bg-muted px-3 py-1'}>
      <span className={strong ? 'opacity-85' : 'text-muted-foreground'}>{label}</span> <span className="font-semibold tabular">{value}</span>
    </span>
  )
}

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { CheckCircle2, CircleDashed, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

// Status colours, validated for colour-vision deficiency on the dark surface
// (teal vs red ΔE 10.7 deutan). Always shown with an icon, label and count.
export const ANSWER_COLORS = { correct: '#2dd4bf', wrong: '#f87171', unanswered: '#6b7280' } as const

const META = {
  correct: { label: 'Correct', icon: CheckCircle2 },
  wrong: { label: 'Wrong', icon: XCircle },
  unanswered: { label: 'Unanswered', icon: CircleDashed },
} as const

type Key = keyof typeof META

export function AnswerDonut({ correct, wrong, unanswered = 0, size = 160, marks, className }: {
  correct: number; wrong: number; unanswered?: number; size?: number; marks?: string; className?: string
}) {
  const total = correct + wrong + unanswered
  const data = (['correct', 'wrong', 'unanswered'] as Key[])
    .map((k) => ({ key: k, name: META[k].label, value: k === 'correct' ? correct : k === 'wrong' ? wrong : unanswered }))
  const slices = data.filter((d) => d.value > 0)
  const pct = total ? Math.round((correct / total) * 100) : 0

  return (
    <div className={cn('flex flex-wrap items-center gap-6', className)}>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            {/* track */}
            <Pie data={[{ value: 1 }]} dataKey="value" innerRadius="70%" outerRadius="100%" fill="rgb(255 255 255 / 0.06)" stroke="none" isAnimationActive={false} />
            <Pie
              data={slices}
              dataKey="value"
              nameKey="name"
              innerRadius="70%"
              outerRadius="100%"
              startAngle={90}
              endAngle={-270}
              paddingAngle={slices.length > 1 ? 2 : 0}
              // rounded ends on a single 360° slice produce a degenerate path in Recharts
              cornerRadius={slices.length > 1 ? 4 : 0}
              stroke="none"
              animationDuration={600}
            >
              {slices.map((d) => <Cell key={d.key} fill={ANSWER_COLORS[d.key]} />)}
            </Pie>
            <Tooltip
              cursor={false}
              content={({ active, payload }) => active && payload?.[0] && payload[0].name ? (
                <div className="rounded-md border border-border-strong bg-popover px-3 py-2 text-xs shadow-lg">
                  <span className="font-semibold">{payload[0].name}</span>
                  <span className="ml-2 text-muted-foreground tabular">{payload[0].value} of {total}</span>
                </div>
              ) : null}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-2xl font-bold tabular">{pct}%</span>
          <span className="text-[11px] text-muted-foreground tabular">{correct}/{total} correct</span>
        </div>
      </div>

      <ul className="flex min-w-36 flex-col gap-2.5" aria-label="Answer breakdown">
        {data.filter((d) => d.key !== 'unanswered' || d.value > 0).map((d) => {
          const Icon = META[d.key].icon
          return (
            <li key={d.key} className="flex items-center gap-2.5 text-sm">
              <Icon className="size-4 shrink-0" style={{ color: ANSWER_COLORS[d.key] }} aria-hidden="true" />
              <span className="flex-1 text-muted-foreground">{d.name}</span>
              <span className="font-semibold tabular">{d.value}</span>
            </li>
          )
        })}
        {marks && (
          <li className="mt-1 flex items-center gap-2.5 border-t border-border pt-2.5 text-sm">
            <span className="flex-1 text-muted-foreground">Marks</span>
            <span className="font-semibold tabular">{marks}</span>
          </li>
        )}
      </ul>
    </div>
  )
}

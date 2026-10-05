import { cn } from '@/lib/utils'

export function Brand({ className, subtitle }: { className?: string; subtitle?: string }) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <div className="flex size-9 items-center justify-center rounded-lg border border-border-strong bg-card-strong">
        <svg viewBox="0 0 32 32" className="size-5" aria-hidden="true">
          <path d="M9 23V9h7.2a4.8 4.8 0 0 1 0 9.6H12.6V23z" fill="none" stroke="#7DD3FC" strokeWidth="2.8" strokeLinejoin="round" />
        </svg>
      </div>
      <div className="leading-tight">
        <div className="font-display text-lg font-semibold">Pariksha</div>
        {subtitle && <div className="text-xs text-muted-foreground">{subtitle}</div>}
      </div>
    </div>
  )
}

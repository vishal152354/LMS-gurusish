import { cn } from '@/lib/utils'

// Gurusish sun mark + wordmark. Swap public/gurusish-logo.svg for the official artwork.
export function Brand({ className, subtitle }: { className?: string; subtitle?: string }) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <img src="/gurusish-logo.svg" alt="" className="size-9 shrink-0 drop-shadow-sm" />
      <div className="text-lg font-bold uppercase tracking-[0.08em]">Gurusish</div>
      <div className="h-8 w-px bg-current opacity-30" aria-hidden="true" />
      <div className="leading-tight">
        <div className="text-sm font-semibold">Pariksha</div>
        <div className="text-xs text-muted-foreground">{subtitle ?? 'AI assessment'}</div>
      </div>
    </div>
  )
}

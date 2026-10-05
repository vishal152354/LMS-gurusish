import * as React from 'react'
import * as ProgressPrimitive from '@radix-ui/react-progress'
import { cn } from '@/lib/utils'

export function Progress({ className, value = 0, indicatorClassName, shimmer, ...props }: React.ComponentProps<typeof ProgressPrimitive.Root> & { indicatorClassName?: string; shimmer?: boolean }) {
  return (
    <ProgressPrimitive.Root className={cn('relative h-2 w-full overflow-hidden rounded-full bg-muted', className)} value={value} {...props}>
      <ProgressPrimitive.Indicator
        className={cn('relative h-full overflow-hidden rounded-full bg-gradient-to-r from-sky-400 to-accent transition-[width] duration-300 ease-out', indicatorClassName)}
        style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }}
      >
        {shimmer && <span className="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-white/35 to-transparent" />}
      </ProgressPrimitive.Indicator>
    </ProgressPrimitive.Root>
  )
}

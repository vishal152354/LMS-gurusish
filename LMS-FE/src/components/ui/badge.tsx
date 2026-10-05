import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva('inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap', {
  variants: {
    variant: {
      default: 'border-border bg-muted text-muted-foreground',
      success: 'border-success/30 bg-success-soft text-success-text',
      destructive: 'border-destructive/30 bg-destructive-soft text-destructive-text',
      warning: 'border-warning/30 bg-warning-soft text-warning-text',
      accent: 'border-accent/30 bg-accent-soft text-accent',
    },
  },
  defaultVariants: { variant: 'default' },
})

export function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

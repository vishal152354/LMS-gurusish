import * as React from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cn } from '@/lib/utils'

export const Tabs = TabsPrimitive.Root
export function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn('inline-flex h-11 items-center gap-1 rounded-lg border border-border bg-card p-1', className)} {...props} />
}
export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn('inline-flex h-full items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground data-[state=active]:bg-card-strong data-[state=active]:text-foreground cursor-pointer', className)}
      {...props}
    />
  )
}
export const TabsContent = ({ className, ...p }: React.ComponentProps<typeof TabsPrimitive.Content>) =>
  <TabsPrimitive.Content className={cn('mt-5 focus-visible:outline-none', className)} {...p} />

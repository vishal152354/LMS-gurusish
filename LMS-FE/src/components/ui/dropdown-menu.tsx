import * as React from 'react'
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import { cn } from '@/lib/utils'

export const DropdownMenu = DropdownMenuPrimitive.Root
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger
export function DropdownMenuContent({ className, sideOffset = 6, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content sideOffset={sideOffset} className={cn('z-50 min-w-[12rem] overflow-hidden rounded-md border border-border-strong bg-popover p-1 shadow-xl data-[state=open]:animate-[fade-up_0.15s_ease]', className)} {...props} />
    </DropdownMenuPrimitive.Portal>
  )
}
export function DropdownMenuItem({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Item>) {
  return <DropdownMenuPrimitive.Item className={cn('relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-muted [&_svg]:size-4', className)} {...props} />
}
export const DropdownMenuLabel = ({ className, ...p }: React.ComponentProps<typeof DropdownMenuPrimitive.Label>) =>
  <DropdownMenuPrimitive.Label className={cn('px-2.5 py-1.5 text-xs font-semibold text-muted-foreground', className)} {...p} />
export const DropdownMenuSeparator = ({ className, ...p }: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) =>
  <DropdownMenuPrimitive.Separator className={cn('-mx-1 my-1 h-px bg-border', className)} {...p} />

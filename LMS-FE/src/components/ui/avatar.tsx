import * as React from 'react'
import * as AvatarPrimitive from '@radix-ui/react-avatar'
import { cn } from '@/lib/utils'

export const Avatar = ({ className, ...p }: React.ComponentProps<typeof AvatarPrimitive.Root>) =>
  <AvatarPrimitive.Root className={cn('relative flex size-9 shrink-0 overflow-hidden rounded-full border border-border-strong', className)} {...p} />
export const AvatarImage = ({ className, ...p }: React.ComponentProps<typeof AvatarPrimitive.Image>) =>
  <AvatarPrimitive.Image className={cn('aspect-square size-full object-cover', className)} {...p} />
export const AvatarFallback = ({ className, ...p }: React.ComponentProps<typeof AvatarPrimitive.Fallback>) =>
  <AvatarPrimitive.Fallback className={cn('flex size-full items-center justify-center bg-accent-soft text-xs font-bold text-accent', className)} {...p} />

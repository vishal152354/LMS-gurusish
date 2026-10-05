import * as React from 'react'
import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog'
import { cn } from '@/lib/utils'
import { buttonVariants } from './button'

export const AlertDialog = AlertDialogPrimitive.Root
export const AlertDialogTrigger = AlertDialogPrimitive.Trigger

export function AlertDialogContent({ className, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Content>) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
      <AlertDialogPrimitive.Content
        className={cn('fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border-strong bg-popover p-6 shadow-2xl data-[state=open]:animate-[fade-up_0.2s_ease]', className)}
        {...props}
      />
    </AlertDialogPrimitive.Portal>
  )
}
export const AlertDialogTitle = ({ className, ...p }: React.ComponentProps<typeof AlertDialogPrimitive.Title>) =>
  <AlertDialogPrimitive.Title className={cn('font-display text-lg font-semibold', className)} {...p} />
export const AlertDialogDescription = ({ className, ...p }: React.ComponentProps<typeof AlertDialogPrimitive.Description>) =>
  <AlertDialogPrimitive.Description className={cn('mt-2 text-sm text-muted-foreground', className)} {...p} />
export const AlertDialogFooter = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) =>
  <div className={cn('mt-6 flex justify-end gap-2', className)} {...p} />
export const AlertDialogCancel = ({ className, ...p }: React.ComponentProps<typeof AlertDialogPrimitive.Cancel>) =>
  <AlertDialogPrimitive.Cancel className={cn(buttonVariants({ variant: 'outline' }), className)} {...p} />
export const AlertDialogAction = ({ className, ...p }: React.ComponentProps<typeof AlertDialogPrimitive.Action>) =>
  <AlertDialogPrimitive.Action className={cn(buttonVariants({ variant: 'destructive' }), className)} {...p} />

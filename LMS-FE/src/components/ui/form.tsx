import * as React from 'react'
import {
  Controller, FormProvider, useFormContext, useFormState,
  type ControllerProps, type FieldPath, type FieldValues,
} from 'react-hook-form'
import { Slot } from '@radix-ui/react-slot'
import { cn } from '@/lib/utils'
import { Label } from './label'

export const Form = FormProvider

type FieldCtx = { name: string }
const FormFieldContext = React.createContext<FieldCtx | null>(null)
const FormItemContext = React.createContext<{ id: string } | null>(null)

export function FormField<TFieldValues extends FieldValues, TName extends FieldPath<TFieldValues>>(props: ControllerProps<TFieldValues, TName>) {
  return (
    <FormFieldContext.Provider value={{ name: props.name }}>
      <Controller {...props} />
    </FormFieldContext.Provider>
  )
}

function useFormField() {
  const field = React.useContext(FormFieldContext)
  const item = React.useContext(FormItemContext)
  const { getFieldState } = useFormContext()
  const formState = useFormState({ name: field?.name })
  if (!field || !item) throw new Error('useFormField must be used inside <FormField> and <FormItem>')
  const state = getFieldState(field.name, formState)
  return { id: item.id, formItemId: `${item.id}-item`, messageId: `${item.id}-message`, descriptionId: `${item.id}-description`, ...state }
}

export function FormItem({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const id = React.useId()
  return (
    <FormItemContext.Provider value={{ id }}>
      <div className={cn('flex flex-col gap-2', className)} {...props} />
    </FormItemContext.Provider>
  )
}

export function FormLabel({ className, ...props }: React.ComponentProps<typeof Label>) {
  const { error, formItemId } = useFormField()
  return <Label htmlFor={formItemId} className={cn(error && 'text-destructive-text', className)} {...props} />
}

export function FormControl(props: React.ComponentProps<typeof Slot>) {
  const { error, formItemId, messageId, descriptionId } = useFormField()
  return <Slot id={formItemId} aria-invalid={!!error} aria-describedby={error ? `${descriptionId} ${messageId}` : descriptionId} {...props} />
}

export function FormDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  const { descriptionId } = useFormField()
  return <p id={descriptionId} className={cn('text-xs text-subtle-foreground', className)} {...props} />
}

export function FormMessage({ className, children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  const { error, messageId } = useFormField()
  const body = error ? String(error.message ?? '') : children
  if (!body) return null
  return <p id={messageId} role="alert" className={cn('text-xs font-medium text-destructive-text', className)} {...props}>{body}</p>
}

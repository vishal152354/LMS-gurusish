import { DayPicker, type DayPickerProps } from 'react-day-picker'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Calendar({ className, classNames, ...props }: DayPickerProps) {
  return (
    <DayPicker
      showOutsideDays
      className={cn('p-1 text-sm', className)}
      classNames={{
        months: 'flex flex-col gap-4',
        month: 'flex flex-col gap-3',
        month_caption: 'flex h-8 items-center justify-center font-semibold',
        nav: 'absolute inset-x-1 top-1 flex justify-between',
        button_previous: 'inline-flex size-8 items-center justify-center rounded-full hover:bg-muted cursor-pointer',
        button_next: 'inline-flex size-8 items-center justify-center rounded-full hover:bg-muted cursor-pointer',
        weekdays: 'flex',
        weekday: 'w-9 text-center text-xs font-medium text-subtle-foreground',
        week: 'mt-1 flex',
        day: 'size-9 p-0 text-center',
        day_button: 'size-9 rounded-full hover:bg-muted cursor-pointer tabular',
        selected: '[&>button]:bg-accent [&>button]:text-accent-foreground [&>button]:font-bold',
        today: '[&>button]:ring-1 [&>button]:ring-accent/50',
        outside: 'text-subtle-foreground opacity-50',
        disabled: 'opacity-30',
        root: 'relative',
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) => orientation === 'left' ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />,
      }}
      {...props}
    />
  )
}

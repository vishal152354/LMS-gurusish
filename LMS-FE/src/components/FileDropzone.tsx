import { useRef, useState } from 'react'
import { UploadCloud } from 'lucide-react'
import { cn } from '@/lib/utils'

export function FileDropzone({ accept, hint, disabled, onFile, children }: {
  accept: string; hint: string; disabled?: boolean; onFile: (f: File) => void; children?: React.ReactNode
}) {
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      onClick={() => !disabled && input.current?.click()}
      onKeyDown={(e) => { if (!disabled && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); input.current?.click() } }}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f && !disabled) onFile(f) }}
      className={cn(
        'glass flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border-strong px-6 py-10 text-center transition-all',
        'hover:border-accent/60 focus-visible:border-accent',
        over && 'scale-[1.01] border-accent bg-accent-soft',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      {children ?? (
        <>
          <UploadCloud className={cn('size-8 text-subtle-foreground transition-colors', over && 'text-accent')} />
          <p className="font-semibold">Drop a file here or click to browse</p>
          <p className="text-sm text-muted-foreground">{hint}</p>
        </>
      )}
      <input ref={input} type="file" accept={accept} className="sr-only" tabIndex={-1}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = '' }} />
    </div>
  )
}

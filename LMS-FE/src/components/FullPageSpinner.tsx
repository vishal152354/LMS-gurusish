import { Loader2 } from 'lucide-react'

export function FullPageSpinner({ label }: { label?: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-muted-foreground" role="status">
      <Loader2 className="size-6 animate-spin text-accent" />
      {label && <p className="text-sm">{label}</p>}
    </div>
  )
}

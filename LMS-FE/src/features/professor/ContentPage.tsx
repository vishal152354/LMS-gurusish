import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, FileText, Loader2, Pencil, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { FileDropzone } from '@/components/FileDropzone'
import { PageHeader } from '@/components/PageHeader'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { fromUtc } from '@/lib/utils'
import { useTour } from '@/features/guide/guideContext'
import { apiError } from '@/services/http'
import { professorApi } from '@/services/professorApi'
import { useAppSelector } from '@/store'
import type { ContentItem, PipelineStatus } from '@/types/api'

const ACCEPT = '.pdf,.docx,.txt,.md'
const MAX_MB = 20

export default function ContentPage() {
  const token = useAppSelector((s) => s.auth.professor!.token)
  const [items, setItems] = useState<ContentItem[] | null>(null)
  const [uploadPct, setUploadPct] = useState<number | null>(null)
  const [status, setStatus] = useState<Record<string, PipelineStatus>>({})
  const [toDelete, setToDelete] = useState<ContentItem | null>(null)
  useTour('prof-content', items !== null)

  const load = useCallback(async () => {
    try { setItems(await professorApi.listContent()) } catch (e) { toast.error(apiError(e)) }
  }, [])
  useEffect(() => { load() }, [load])

  // Poll processing uploads until they're ready
  const processing = (items ?? []).filter((i) => !i.okf_ready).map((i) => i.upload_id).join(',')
  useEffect(() => {
    if (!processing) return
    const ids = processing.split(',')
    const t = window.setInterval(async () => {
      const entries = await Promise.all(ids.map(async (id) => [id, await professorApi.pipelineStatus(id).catch(() => null)] as const))
      setStatus((s) => ({ ...s, ...Object.fromEntries(entries.filter((e): e is readonly [string, PipelineStatus] => !!e[1])) }))
      if (entries.some(([, v]) => v?.okf_ready)) {
        load()
        entries.filter(([, v]) => v?.okf_ready).forEach(() => toast.success('Content ready — you can now create a test from it.'))
      }
    }, 2000)
    return () => window.clearInterval(t)
  }, [processing, load])

  async function upload(file: File) {
    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
    if (!ACCEPT.split(',').includes(ext)) return toast.error('Upload a PDF, Word (.docx), text or Markdown file.')
    if (file.size > MAX_MB * 1024 * 1024) return toast.error(`That file is over ${MAX_MB} MB.`)
    setUploadPct(0)
    try {
      await professorApi.uploadContent(file, token, setUploadPct)
      toast.success(`“${file.name}” uploaded`, { description: 'Building the knowledge graph — this takes a few minutes.' })
      load()
    } catch (e) {
      toast.error('Upload failed', { description: apiError(e) })
    } finally {
      setUploadPct(null)
    }
  }

  async function remove(item: ContentItem) {
    try {
      await professorApi.deleteContent(item.upload_id)
      setItems((xs) => xs?.filter((x) => x.upload_id !== item.upload_id) ?? null)
      toast.success('Content deleted')
    } catch (e) { toast.error(apiError(e)) }
  }

  return (
    <div className="animate-fade-up">
      <PageHeader title="Viva content" description="Upload course material. Pariksha extracts its concepts into a knowledge graph, which tests are generated from." />

      <FileDropzone accept={ACCEPT} hint={`PDF, DOCX, TXT or Markdown · up to ${MAX_MB} MB`} disabled={uploadPct !== null} onFile={upload} tour="content-drop">
        {uploadPct !== null ? (
          <div className="w-full max-w-sm">
            <p className="mb-3 font-semibold">Uploading… {uploadPct}%</p>
            <Progress value={uploadPct} shimmer />
          </div>
        ) : undefined}
      </FileDropzone>

      <div className="mt-6 flex flex-col gap-3">
        {!items && [0, 1].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        {items?.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">No content yet — upload your first document above.</p>}
        {items?.map((item) => (
          <ContentRow key={item.upload_id} item={item} status={status[item.upload_id]}
            onRenamed={(name) => setItems((xs) => xs?.map((x) => x.upload_id === item.upload_id ? { ...x, display_name: name } : x) ?? null)}
            onDelete={() => setToDelete(item)} />
        ))}
      </div>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogTitle>Delete “{toDelete?.display_name}”?</AlertDialogTitle>
          <AlertDialogDescription>This removes the document and its knowledge graph. Tests already created from it keep their questions.</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => toDelete && remove(toDelete)}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function ContentRow({ item, status, onRenamed, onDelete }: {
  item: ContentItem; status?: PipelineStatus; onRenamed: (n: string) => void; onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(item.display_name)
  const [saving, setSaving] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { if (editing) input.current?.select() }, [editing])

  async function save() {
    const n = name.trim()
    if (!n || n === item.display_name) { setEditing(false); setName(item.display_name); return }
    setSaving(true)
    try { await professorApi.renameContent(item.upload_id, n); onRenamed(n); setEditing(false) }
    catch (e) { toast.error(apiError(e)) }
    finally { setSaving(false) }
  }

  const pct = status?.percentage ?? item.percentage
  const label = status?.message || status?.step_name || item.label || 'Queued'

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-4 p-4 sm:p-5">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent"><FileText className="size-5" /></div>
        <div className="min-w-0 flex-1">
          {editing ? (
            <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); save() }}>
              <Input ref={input} value={name} onChange={(e) => setName(e.target.value)} className="h-9 max-w-sm"
                onKeyDown={(e) => { if (e.key === 'Escape') { setEditing(false); setName(item.display_name) } }} aria-label="Display name" />
              <Button type="submit" size="icon" variant="ghost" loading={saving} aria-label="Save name"><Check /></Button>
              <Button type="button" size="icon" variant="ghost" onClick={() => { setEditing(false); setName(item.display_name) }} aria-label="Cancel"><X /></Button>
            </form>
          ) : (
            <div className="flex items-center gap-1.5">
              <span className="truncate font-semibold text-accent">{item.display_name}</span>
              <Tooltip><TooltipTrigger asChild>
                <Button size="icon" variant="ghost" className="size-7" onClick={() => setEditing(true)} aria-label="Rename"><Pencil className="size-3.5" /></Button>
              </TooltipTrigger><TooltipContent>Rename</TooltipContent></Tooltip>
              <Tooltip><TooltipTrigger asChild>
                <Button size="icon" variant="ghost" className="size-7 hover:text-destructive-text" onClick={onDelete} aria-label="Delete"><Trash2 className="size-3.5" /></Button>
              </TooltipTrigger><TooltipContent>Delete</TooltipContent></Tooltip>
            </div>
          )}
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            Original: {item.filename} · Uploaded {fromUtc(item.uploaded_at).fromNow()}
          </p>
          {!item.okf_ready && (
            <div className="mt-3 max-w-md">
              <div className="mb-1.5 flex justify-between text-xs text-muted-foreground"><span>{label}</span><span className="tabular">{pct}%</span></div>
              <Progress value={pct} shimmer />
            </div>
          )}
        </div>
        {item.okf_ready ? <Badge variant="success">Ready</Badge> : <Badge variant="warning"><Loader2 className="size-3 animate-spin" />Processing</Badge>}
      </CardContent>
    </Card>
  )
}

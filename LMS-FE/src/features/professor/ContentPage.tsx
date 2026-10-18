import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { FileText, Loader2, RefreshCw, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { fromUtc } from '@/lib/utils'
import { useTour } from '@/features/guide/guideContext'
import { apiError } from '@/services/http'
import { professorApi } from '@/services/professorApi'
import type { ContentItem } from '@/types/api'

/** The admin's content library — read-only for teachers. Tests are built from it on the Events page. */
export default function ContentPage() {
  const [items, setItems] = useState<ContentItem[] | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  useTour('prof-content', items !== null)

  const load = useCallback(async () => {
    setRefreshing(true)
    try { setItems(await professorApi.listContent()) } catch (e) { toast.error(apiError(e)); setItems([]) }
    finally { setRefreshing(false) }
  }, [])
  useEffect(() => { load() }, [load])

  // Refresh while anything is still being processed
  const processing = (items ?? []).some((i) => !i.okf_ready)
  useEffect(() => {
    if (!processing) return
    const t = window.setInterval(load, 5000)
    return () => window.clearInterval(t)
  }, [processing, load])

  const ready = (items ?? []).filter((i) => i.okf_ready).length

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Content library"
        description="Course material uploaded by your admin. Tick the content you need when you create a test on the Events page."
        actions={<Button variant="outline" size="sm" onClick={load} loading={refreshing}><RefreshCw />Refresh</Button>}
      />

      {items && items.length > 0 && (
        <p className="mb-3 text-sm text-muted-foreground tabular" data-tour="content-library">
          {ready} of {items.length} ready to use
        </p>
      )}
      <div className="flex flex-col gap-3">
        {!items && [0, 1].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        {items?.length === 0 && (
          <Card><CardContent className="p-10 text-center text-sm text-muted-foreground">
            No content yet. Ask your admin to upload course material — it will appear here.
          </CardContent></Card>
        )}
        {items?.map((item) => (
          <Card key={item.upload_id}>
            <CardContent className="flex flex-wrap items-center gap-4 p-4 sm:p-5">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent"><FileText className="size-5" /></div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{item.display_name}</div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  Added {fromUtc(item.uploaded_at).fromNow()}
                  {item.test_count ? ` · used in ${item.test_count} test${item.test_count === 1 ? '' : 's'}` : ''}
                </p>
              </div>
              {item.okf_ready ? (
                <>
                  <Badge variant="success">Ready</Badge>
                  <Button asChild size="sm" variant="outline">
                    <Link to={`/teacher/events?content=${encodeURIComponent(item.upload_id)}`}><Sparkles />Use in a test</Link>
                  </Button>
                </>
              ) : (
                <Badge variant="warning"><Loader2 className="size-3 animate-spin" />Processing</Badge>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

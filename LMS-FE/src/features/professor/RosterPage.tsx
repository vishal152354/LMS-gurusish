import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, FileSpreadsheet, Users } from 'lucide-react'
import { toast } from 'sonner'
import { FileDropzone } from '@/components/FileDropzone'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { fromUtc } from '@/lib/utils'
import { useTour } from '@/features/guide/guideContext'
import { apiError } from '@/services/http'
import { professorApi } from '@/services/professorApi'
import { useAppSelector } from '@/store'
import type { RosterEntry } from '@/types/api'
import { EventPicker, useSelectedEvent } from './EventPicker'

export default function RosterPage() {
  const token = useAppSelector((s) => s.auth.professor!.token)
  const { events, eventId, select, reload } = useSelectedEvent()
  const [roster, setRoster] = useState<RosterEntry[] | null>(null)
  const [uploading, setUploading] = useState(false)
  const [warning, setWarning] = useState<string | null>(null)
  useTour('prof-roster', !!eventId)

  const load = useCallback(async () => {
    if (!eventId) return
    setRoster(null)
    try { setRoster((await professorApi.getEvent(eventId)).roster) } catch (e) { toast.error(apiError(e)); setRoster([]) }
  }, [eventId])
  useEffect(() => { setWarning(null); load() }, [load])

  async function upload(file: File) {
    if (!file.name.toLowerCase().endsWith('.csv')) return toast.error('Upload a .csv file')
    setUploading(true)
    try {
      const r = await professorApi.uploadRoster(eventId, file, token)
      toast.success(`${r.added} student${r.added === 1 ? '' : 's'} added`, {
        description: r.notified ? `${r.notified} invite email${r.notified === 1 ? '' : 's'} sent.` : undefined,
      })
      setWarning(r.warning ?? null)
      load(); reload()
    } catch (e) { toast.error('Roster upload failed', { description: apiError(e) }) }
    finally { setUploading(false) }
  }

  return (
    <div className="animate-fade-up">
      <PageHeader title="Roster" description="Assign students to a test by uploading a CSV of roll numbers." />
      <EventPicker events={events} value={eventId} onChange={select} />

      {events?.length === 0 && <p className="mt-8 text-sm text-muted-foreground">Create an event first, then add its roster here.</p>}

      {eventId && (
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,380px)_1fr]">
          <div className="flex flex-col gap-4">
            <FileDropzone accept=".csv" hint="CSV with a roll_number column" disabled={uploading} onFile={upload} tour="roster-drop" />
            {warning && (
              <div className="flex gap-3 rounded-lg border border-warning/30 bg-warning-soft p-4 text-sm text-warning-text">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" /><p>{warning}</p>
              </div>
            )}
            <Card>
              <CardContent className="p-5 text-sm">
                <p className="flex items-center gap-2 font-semibold"><FileSpreadsheet className="size-4 text-accent" />Expected format</p>
                <pre className="mt-3 rounded-md border border-border bg-black/30 p-3 font-mono text-xs leading-relaxed text-muted-foreground">roll_number,name,email{'\n'}CS2023001,Asha R,asha@college.edu{'\n'}CS2023002,Rahul K,</pre>
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                  <span className="font-semibold text-foreground">name</span> and <span className="font-semibold text-foreground">email</span> are optional; email sends an invite.
                  Format the roll number column as <span className="font-semibold text-foreground">Text</span> in Excel — long numbers otherwise become 7.15E+11 and those rows are skipped.
                </p>
              </CardContent>
            </Card>
          </div>

          <Card className="overflow-hidden">
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2"><Users className="size-4 text-accent" />Students</CardTitle>
              {roster && <span className="text-sm text-muted-foreground tabular">{roster.length}</span>}
            </CardHeader>
            <CardContent className="p-0">
              {!roster ? <div className="flex flex-col gap-2 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-9" />)}</div>
                : roster.length === 0 ? <p className="px-6 pb-8 pt-2 text-sm text-muted-foreground">No students yet — upload a CSV.</p>
                : (
                  <Table>
                    <TableHeader><TableRow><TableHead>Roll no.</TableHead><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Added</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {roster.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="font-mono text-xs">{r.roll_number}</TableCell>
                          <TableCell>{r.name || '—'}</TableCell>
                          <TableCell className="text-muted-foreground">{r.email || '—'}</TableCell>
                          <TableCell className="text-muted-foreground">{fromUtc(r.added_at).fromNow()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

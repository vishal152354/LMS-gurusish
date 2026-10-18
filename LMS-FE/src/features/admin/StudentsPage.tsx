import { useCallback, useEffect, useMemo, useState } from 'react'
import { Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/PageHeader'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { fromUtc } from '@/lib/utils'
import { adminApi } from '@/services/adminApi'
import { apiError } from '@/services/http'
import type { ManagedStudent } from '@/types/api'
import { adminChanged } from './adminEvents'

export default function StudentsPage() {
  const [students, setStudents] = useState<ManagedStudent[] | null>(null)
  const [query, setQuery] = useState('')
  const [toDelete, setToDelete] = useState<ManagedStudent | null>(null)

  const load = useCallback(async () => {
    try { setStudents(await adminApi.listStudents()) } catch (e) { toast.error(apiError(e)); setStudents([]) }
  }, [])
  useEffect(() => { load() }, [load])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (students ?? []).filter((s) => !q || s.roll_number.toLowerCase().includes(q) || s.name.toLowerCase().includes(q))
  }, [students, query])

  async function remove(s: ManagedStudent) {
    try {
      await adminApi.deleteStudent(s.id)
      setStudents((xs) => xs?.filter((x) => x.id !== s.id) ?? null)
      adminChanged()
      toast.success(`${s.name} removed`)
    } catch (e) { toast.error('Could not remove student', { description: apiError(e) }) }
  }

  return (
    <div className="animate-fade-up">
      <PageHeader title="Students" description="Everyone who has signed in as a student. Students join themselves with their roll number and name; teachers assign them to tests with a roster." />
      <div>
        <Card className="h-fit overflow-hidden">
          <div className="border-b border-border p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by roll number or name" className="pl-9" aria-label="Search students" />
            </div>
          </div>
          {!students ? (
            <div className="flex flex-col gap-2 p-5">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : shown.length === 0 ? (
            <p className="p-10 text-center text-sm text-muted-foreground">{students.length ? 'No students match your search.' : 'No students have signed in yet.'}</p>
          ) : (
            <div className="max-h-[560px] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10">
                  <TableRow>
                    <TableHead>Roll no.</TableHead><TableHead>Name</TableHead>
                    <TableHead className="text-right">Tests taken</TableHead>
                    <TableHead className="hidden md:table-cell">Added</TableHead><TableHead className="w-14" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-mono text-xs">{s.roll_number}</TableCell>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell className="text-right tabular">{s.tests_taken}</TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">{s.created_at ? fromUtc(s.created_at).format('D MMM YYYY') : '—'}</TableCell>
                      <TableCell>
                        <Button size="icon" variant="ghost" className="hover:text-destructive-text" onClick={() => setToDelete(s)}
                          aria-label={`Remove ${s.name}`} title="Remove"><Trash2 /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {students && students.length > 0 && (
            <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground tabular">
              Showing {shown.length} of {students.length} student{students.length === 1 ? '' : 's'}
            </p>
          )}
        </Card>
      </div>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogTitle>Remove {toDelete?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            {toDelete?.tests_taken
              ? 'This student has test results on record, so they can’t be removed.'
              : `Roll number ${toDelete?.roll_number} is removed from the system. This can’t be undone.`}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => toDelete && remove(toDelete)} disabled={!!toDelete?.tests_taken}>Remove student</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

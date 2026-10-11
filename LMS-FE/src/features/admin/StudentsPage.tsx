import { useCallback, useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { FileSpreadsheet, Search, Trash2, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { FileDropzone } from '@/components/FileDropzone'
import { PageHeader } from '@/components/PageHeader'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { fromUtc } from '@/lib/utils'
import { adminApi } from '@/services/adminApi'
import { apiError } from '@/services/http'
import type { ManagedStudent } from '@/types/api'
import { adminChanged } from './adminEvents'

const schema = z.object({
  roll_number: z.string().trim().min(1, 'Enter a roll number')
    .regex(/^[A-Za-z0-9/-]+$/, 'Use letters, numbers, “-” or “/” only').max(32, 'That roll number is too long'),
  name: z.string().trim().min(2, 'Enter the student’s full name').max(80),
})
type Values = z.infer<typeof schema>

export default function StudentsPage() {
  const [students, setStudents] = useState<ManagedStudent[] | null>(null)
  const [query, setQuery] = useState('')
  const [importing, setImporting] = useState(false)
  const [toDelete, setToDelete] = useState<ManagedStudent | null>(null)

  const load = useCallback(async () => {
    try { setStudents(await adminApi.listStudents()) } catch (e) { toast.error(apiError(e)); setStudents([]) }
  }, [])
  useEffect(() => { load() }, [load])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (students ?? []).filter((s) => !q || s.roll_number.toLowerCase().includes(q) || s.name.toLowerCase().includes(q))
  }, [students, query])

  async function importCsv(file: File) {
    if (!file.name.toLowerCase().endsWith('.csv')) return toast.error('Upload a .csv file')
    setImporting(true)
    try {
      const r = await adminApi.importStudents(file)
      const parts = [`${r.added} added`]
      if (r.skipped) parts.push(`${r.skipped} already existed`)
      if (r.invalid_count) parts.push(`${r.invalid_count} row${r.invalid_count === 1 ? '' : 's'} skipped (line ${r.invalid_rows.join(', ')})`)
      ;(r.invalid_count ? toast.warning : toast.success)('Students imported', { description: parts.join(' · ') })
      await load()
      adminChanged()
    } catch (e) { toast.error('Import failed', { description: apiError(e) }) }
    finally { setImporting(false) }
  }

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
      <PageHeader title="Students" description="Add students one at a time or import a class list. Students sign in with their roll number and name." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_1fr]">
        <div className="flex flex-col gap-6">
          <AddStudentCard onAdded={(s) => { setStudents((xs) => [...(xs ?? []), s].sort((a, b) => a.roll_number.localeCompare(b.roll_number))); adminChanged() }} />
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><FileSpreadsheet className="size-4 text-accent" />Import a class list</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-3">
              <FileDropzone accept=".csv" hint={importing ? 'Importing…' : 'Drop a CSV here or click to choose'} disabled={importing} onFile={importCsv} />
              <pre className="rounded-md border border-border bg-muted p-3 font-mono text-xs leading-relaxed text-muted-foreground">roll_number,name{'\n'}CS2023001,Asha R{'\n'}CS2023002,Rahul K</pre>
              <p className="text-xs text-muted-foreground">Existing roll numbers are skipped, so it’s safe to import the same list twice.</p>
            </CardContent>
          </Card>
        </div>

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
            <p className="p-10 text-center text-sm text-muted-foreground">{students.length ? 'No students match your search.' : 'No students yet.'}</p>
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

function AddStudentCard({ onAdded }: { onAdded: (s: ManagedStudent) => void }) {
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { roll_number: '', name: '' } })

  async function onSubmit(v: Values) {
    try {
      const s = await adminApi.createStudent(v)
      onAdded(s)
      toast.success(`${s.name} added`, { description: `Roll number ${s.roll_number}` })
      form.reset()
      form.setFocus('roll_number')
    } catch (e) { form.setError('roll_number', { message: apiError(e) }) }
  }

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><UserPlus className="size-4 text-accent" />Add a student</CardTitle></CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
            <FormField control={form.control} name="roll_number" render={({ field }) => (
              <FormItem><FormLabel>Roll number</FormLabel><FormControl><Input placeholder="e.g. CS2023001" autoCapitalize="characters" autoComplete="off" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem><FormLabel>Full name</FormLabel><FormControl><Input placeholder="As on their college ID" autoComplete="off" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <Button type="submit" size="lg" loading={form.formState.isSubmitting}>Add student</Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}

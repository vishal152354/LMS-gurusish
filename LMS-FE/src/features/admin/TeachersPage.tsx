import { useCallback, useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Eye, EyeOff, KeyRound, Trash2, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/PageHeader'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { fromUtc, initials } from '@/lib/utils'
import { adminApi } from '@/services/adminApi'
import { apiError } from '@/services/http'
import type { Teacher } from '@/types/api'
import { adminChanged } from './adminEvents'

const password = z.string().min(8, 'At least 8 characters').max(128)
const schema = z.object({
  display_name: z.string().trim().min(2, 'Enter the teacher’s name').max(80),
  username: z.string().trim().regex(/^[A-Za-z0-9._-]{3,32}$/, '3–32 letters, numbers, “.”, “-” or “_”'),
  password,
})
type Values = z.infer<typeof schema>

export default function TeachersPage() {
  const [teachers, setTeachers] = useState<Teacher[] | null>(null)
  const [resetFor, setResetFor] = useState<Teacher | null>(null)
  const [toDelete, setToDelete] = useState<Teacher | null>(null)

  const load = useCallback(async () => {
    try { setTeachers(await adminApi.listTeachers()) } catch (e) { toast.error(apiError(e)); setTeachers([]) }
  }, [])
  useEffect(() => { load() }, [load])

  async function remove(t: Teacher) {
    try {
      await adminApi.deleteTeacher(t.id)
      setTeachers((xs) => xs?.filter((x) => x.id !== t.id) ?? null)
      adminChanged()
      toast.success(`${t.display_name} removed`)
    } catch (e) { toast.error('Could not remove teacher', { description: apiError(e) }) }
  }

  return (
    <div className="animate-fade-up">
      <PageHeader title="Teachers" description="Create teacher accounts. Teachers sign in on the Teacher tab to upload content, create tests and see results." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_1fr]">
        <AddTeacherCard onAdded={(t) => { setTeachers((xs) => [...(xs ?? []), t]); adminChanged() }} />

        <Card className="overflow-hidden">
          {!teachers ? (
            <div className="flex flex-col gap-2 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : teachers.length === 0 ? (
            <p className="p-10 text-center text-sm text-muted-foreground">No teachers yet. Add the first one on the left.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Teacher</TableHead><TableHead>Username</TableHead>
                  <TableHead className="text-right">Tests</TableHead><TableHead className="text-right">Content</TableHead>
                  <TableHead className="hidden md:table-cell">Added</TableHead><TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {teachers.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <Avatar className="size-8"><AvatarFallback>{initials(t.display_name)}</AvatarFallback></Avatar>
                        <span className="font-semibold">{t.display_name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{t.username}</TableCell>
                    <TableCell className="text-right tabular">{t.test_count}</TableCell>
                    <TableCell className="text-right tabular">{t.content_count}</TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">{t.created_at ? fromUtc(t.created_at).format('D MMM YYYY') : '—'}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button size="icon" variant="ghost" onClick={() => setResetFor(t)} aria-label={`Reset password for ${t.display_name}`} title="Reset password"><KeyRound /></Button>
                        <Button size="icon" variant="ghost" className="hover:text-destructive-text" onClick={() => setToDelete(t)}
                          aria-label={`Remove ${t.display_name}`} title="Remove"><Trash2 /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>

      <ResetPasswordDialog teacher={resetFor} onClose={() => setResetFor(null)} />

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogTitle>Remove {toDelete?.display_name}?</AlertDialogTitle>
          <AlertDialogDescription>
            {toDelete && (toDelete.test_count || toDelete.content_count)
              ? `This teacher still has ${toDelete.test_count} test(s) and ${toDelete.content_count} content file(s). They need to delete those first.`
              : 'They will no longer be able to sign in. This can’t be undone.'}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => toDelete && remove(toDelete)}
              disabled={!!toDelete && !!(toDelete.test_count || toDelete.content_count)}>Remove teacher</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function AddTeacherCard({ onAdded }: { onAdded: (t: Teacher) => void }) {
  const [show, setShow] = useState(false)
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { display_name: '', username: '', password: '' } })

  async function onSubmit(v: Values) {
    try {
      const t = await adminApi.createTeacher(v)
      onAdded(t)
      toast.success(`${t.display_name} added`, { description: `They can sign in as “${t.username}” on the Teacher tab.` })
      form.reset()
    } catch (e) { form.setError('username', { message: apiError(e) }) }
  }

  return (
    <Card className="h-fit">
      <CardHeader><CardTitle className="flex items-center gap-2"><UserPlus className="size-4 text-accent" />Add a teacher</CardTitle></CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
            <FormField control={form.control} name="display_name" render={({ field }) => (
              <FormItem><FormLabel>Name</FormLabel><FormControl><Input placeholder="e.g. Priya Raman" autoComplete="off" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="username" render={({ field }) => (
              <FormItem><FormLabel>Username</FormLabel><FormControl><Input placeholder="e.g. priya.r" autoComplete="off" autoCapitalize="none" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="password" render={({ field }) => (
              <FormItem>
                <FormLabel>Password</FormLabel>
                <div className="relative">
                  <FormControl><Input type={show ? 'text' : 'password'} autoComplete="new-password" className="pr-10" {...field} /></FormControl>
                  <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}
                    className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground cursor-pointer">
                    {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                <FormDescription>Share it with the teacher privately.</FormDescription>
                <FormMessage />
              </FormItem>
            )} />
            <Button type="submit" size="lg" loading={form.formState.isSubmitting}>Add teacher</Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}

function ResetPasswordDialog({ teacher, onClose }: { teacher: Teacher | null; onClose: () => void }) {
  const form = useForm<{ password: string }>({ resolver: zodResolver(z.object({ password })), defaultValues: { password: '' } })
  useEffect(() => { if (teacher) form.reset({ password: '' }) }, [teacher, form])

  async function onSubmit(v: { password: string }) {
    if (!teacher) return
    try {
      await adminApi.resetTeacherPassword(teacher.id, v.password)
      toast.success(`Password changed for ${teacher.display_name}`)
      onClose()
    } catch (e) { form.setError('password', { message: apiError(e) }) }
  }

  return (
    <Dialog open={!!teacher} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset password</DialogTitle>
          <DialogDescription>Set a new password for {teacher?.display_name} ({teacher?.username}). Their current sessions will sign out.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
            <FormField control={form.control} name="password" render={({ field }) => (
              <FormItem><FormLabel>New password</FormLabel><FormControl><Input type="password" autoComplete="new-password" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
              <Button type="submit" loading={form.formState.isSubmitting}>Save password</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

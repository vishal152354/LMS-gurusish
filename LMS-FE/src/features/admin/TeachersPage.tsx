import { useCallback, useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { KeyRound, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/PageHeader'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { fromUtc, initials } from '@/lib/utils'
import { adminApi } from '@/services/adminApi'
import { apiError } from '@/services/http'
import type { Teacher } from '@/types/api'
import { adminChanged } from './adminEvents'

const password = z.string().min(8, 'At least 8 characters').max(128)

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
      <PageHeader title="Teachers" description="Every teacher account and how many tests each has made. Reset a password or remove an unused account." />
      <div>
        <Card className="overflow-hidden">
          {!teachers ? (
            <div className="flex flex-col gap-2 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : teachers.length === 0 ? (
            <p className="p-10 text-center text-sm text-muted-foreground">No teacher accounts yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Teacher</TableHead><TableHead>Username</TableHead>
                  <TableHead className="text-right">Tests</TableHead>
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
            {toDelete?.test_count
              ? `This teacher still has ${toDelete.test_count} test(s). They need to delete those first.`
              : 'They will no longer be able to sign in. This can’t be undone.'}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => toDelete && remove(toDelete)}
              disabled={!!toDelete?.test_count}>Remove teacher</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
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

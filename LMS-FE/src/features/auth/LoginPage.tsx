import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { BarChart3, BookOpenCheck, GraduationCap, Hand, ShieldCheck, UserRound } from 'lucide-react'
import { Brand } from '@/components/Brand'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Carousel, CarouselContent, CarouselDots, CarouselItem } from '@/components/ui/carousel'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { apiError } from '@/services/http'
import { professorApi } from '@/services/professorApi'
import { studentApi } from '@/services/studentApi'
import { useAppDispatch, useAppSelector } from '@/store'
import { professorLoggedIn, studentLoggedIn } from '@/store/authSlice'

const studentSchema = z.object({
  roll: z.string().trim().min(1, 'Enter your roll number')
    .regex(/^[A-Za-z0-9/-]+$/, 'Use letters, numbers, “-” or “/” only')
    .max(32, 'That roll number is too long'),
  name: z.string().trim().min(2, 'Enter your full name').max(80),
})

const professorSchema = z.object({
  username: z.string().trim().min(1, 'Enter your username'),
  password: z.string().min(1, 'Enter your password'),
})

const SLIDES = [
  { icon: BookOpenCheck, title: 'From course notes to question paper', body: 'Upload a PDF or Word file — Pariksha builds a knowledge graph and writes a fresh MCQ paper for every test.' },
  { icon: Hand, title: 'Answer by drag and drop', body: 'Students drag the right option into place on any device, and see why it’s right straight after.' },
  { icon: BarChart3, title: 'Results that explain themselves', body: 'Per-student answer charts, question-by-question breakdowns and one-click Excel export.' },
  { icon: ShieldCheck, title: 'Fair by design', body: 'One attempt per test, full-screen mode and tab-switch monitoring keep every test honest.' },
]

export default function LoginPage() {
  const [params, setParams] = useSearchParams()
  const role = params.get('role') === 'professor' ? 'professor' : 'student'
  const { student, professor } = useAppSelector((s) => s.auth)
  const loc = useLocation()

  // Already signed in as the role being shown → go straight in
  if (role === 'student' && student) return <Navigate to="/student" replace />
  if (role === 'professor' && professor) return <Navigate to={(loc.state as { from?: string })?.from ?? '/professor'} replace />

  return (
    <div className="mx-auto grid min-h-screen max-w-6xl items-center gap-10 px-4 py-10 lg:grid-cols-[1.1fr_1fr] lg:px-8">
      <section className="hidden lg:block">
        <Brand subtitle="AI viva & assessment portal" />
        <h1 className="mt-10 font-display text-5xl font-semibold leading-[1.1]">
          Assess understanding,<br /><span className="text-accent">not memory.</span>
        </h1>
        <Carousel className="mt-12 max-w-md">
          <CarouselContent>
            {SLIDES.map(({ icon: Icon, title, body }) => (
              <CarouselItem key={title}>
                <div className="pr-6">
                  <Icon className="size-6 text-accent" aria-hidden="true" />
                  <h2 className="mt-3 text-lg font-semibold">{title}</h2>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
                </div>
              </CarouselItem>
            ))}
          </CarouselContent>
          <CarouselDots className="mt-6 justify-start" />
        </Carousel>
      </section>

      <section className="mx-auto w-full max-w-md animate-fade-up">
        <Brand className="mb-8 lg:hidden" subtitle="AI viva & assessment portal" />
        <Card>
          <CardContent className="p-6 sm:p-8">
            <h2 className="font-display text-2xl font-semibold">Sign in</h2>
            <p className="mt-1 text-sm text-muted-foreground">Choose how you’re using Pariksha today.</p>
            <Tabs value={role} onValueChange={(v) => setParams(v === 'professor' ? { role: 'professor' } : {}, { replace: true })} className="mt-6">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="student"><GraduationCap />Student</TabsTrigger>
                <TabsTrigger value="professor"><UserRound />Professor</TabsTrigger>
              </TabsList>
              <TabsContent value="student"><StudentForm /></TabsContent>
              <TabsContent value="professor"><ProfessorForm /></TabsContent>
            </Tabs>
          </CardContent>
        </Card>
        <p className="mt-6 text-center text-xs text-subtle-foreground">Data stays on your institution’s server.</p>
      </section>
    </div>
  )
}

function StudentForm() {
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const form = useForm<z.infer<typeof studentSchema>>({ resolver: zodResolver(studentSchema), defaultValues: { roll: '', name: '' } })

  async function onSubmit(v: z.infer<typeof studentSchema>) {
    try {
      const res = await studentApi.join(v.roll.toUpperCase(), v.name)
      dispatch(studentLoggedIn({ id: res.student_id, roll: v.roll.toUpperCase(), name: res.name }))
      toast.success(`Welcome${res.is_returning ? ' back' : ''}, ${res.name.split(' ')[0]}!`)
      navigate('/student')
    } catch (e) {
      toast.error('Could not sign in', { description: apiError(e) })
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
        <FormField control={form.control} name="roll" render={({ field }) => (
          <FormItem>
            <FormLabel>Roll number</FormLabel>
            <FormControl><Input placeholder="e.g. CS2023001" autoComplete="username" autoCapitalize="characters" {...field} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <FormField control={form.control} name="name" render={({ field }) => (
          <FormItem>
            <FormLabel>Full name</FormLabel>
            <FormControl><Input placeholder="As on your college ID" autoComplete="name" {...field} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <Button type="submit" size="lg" className="mt-2" loading={form.formState.isSubmitting}>Continue to my tests</Button>
      </form>
    </Form>
  )
}

function ProfessorForm() {
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const loc = useLocation()
  const form = useForm<z.infer<typeof professorSchema>>({ resolver: zodResolver(professorSchema), defaultValues: { username: '', password: '' } })

  useEffect(() => { form.setFocus('username') }, [form])

  async function onSubmit(v: z.infer<typeof professorSchema>) {
    try {
      const res = await professorApi.login(v.username, v.password)
      dispatch(professorLoggedIn({ token: res.token, id: res.professor_id, displayName: res.display_name }))
      navigate((loc.state as { from?: string })?.from ?? '/professor')
    } catch (e) {
      form.setError('password', { message: apiError(e, 'Invalid username or password') })
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
        <FormField control={form.control} name="username" render={({ field }) => (
          <FormItem>
            <FormLabel>Username</FormLabel>
            <FormControl><Input autoComplete="username" {...field} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <FormField control={form.control} name="password" render={({ field }) => (
          <FormItem>
            <FormLabel>Password</FormLabel>
            <FormControl><Input type="password" autoComplete="current-password" {...field} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <Button type="submit" size="lg" className="mt-2" loading={form.formState.isSubmitting}>Sign in</Button>
      </form>
    </Form>
  )
}

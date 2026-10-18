import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router'
import { BarChart3, BookOpenCheck, FileText, GraduationCap, LogOut, Presentation, Users } from 'lucide-react'
import { Brand } from '@/components/Brand'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { adminApi } from '@/services/adminApi'
import { useAppDispatch, useAppSelector } from '@/store'
import { adminLoggedOut } from '@/store/authSlice'
import type { AdminStats } from '@/types/api'
import { ADMIN_CHANGED } from './adminEvents'

const NAV = [
  { to: 'content', label: 'Content', icon: FileText },
  { to: 'teachers', label: 'Teachers', icon: Presentation },
  { to: 'students', label: 'Students', icon: GraduationCap },
  { to: 'results', label: 'Test results', icon: BarChart3 },
]

export default function AdminLayout() {
  const admin = useAppSelector((s) => s.auth.admin)!
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const [stats, setStats] = useState<AdminStats | null>(null)

  // Counts refresh whenever a page changes something (it dispatches this event)
  useEffect(() => {
    const load = () => adminApi.stats().then(setStats).catch(() => {})
    load()
    window.addEventListener(ADMIN_CHANGED, load)
    return () => window.removeEventListener(ADMIN_CHANGED, load)
  }, [])

  const logout = () => { dispatch(adminLoggedOut()); navigate('/?role=admin') }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 brand-bar shadow-[0_6px_20px_rgb(90_79_192/0.25)]">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 lg:px-6">
          <Brand subtitle="Admin console" />
          <div className="flex items-center gap-2">
            <span className="hidden text-sm font-semibold sm:inline">{admin.displayName}</span>
            <Button variant="ghost" size="sm" onClick={logout}><LogOut />Sign out</Button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 pb-2 lg:px-6" aria-label="Admin sections">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to}
              className={({ isActive }) => cn(
                'flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors whitespace-nowrap',
                isActive ? 'bg-card-strong text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}>
              <Icon className="size-4" />{label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 lg:px-6">
        <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Stat label="Content" value={stats?.content} icon={FileText} />
          <Stat label="Teachers" value={stats?.teachers} icon={Presentation} />
          <Stat label="Students" value={stats?.students} icon={Users} />
          <Stat label="Tests" value={stats?.tests} icon={BookOpenCheck} />
          <Stat label="Attempts" value={stats?.attempts} icon={GraduationCap} />
        </div>
        <Outlet />
      </main>
    </div>
  )
}

function Stat({ label, value, icon: Icon }: { label: string; value?: number; icon: typeof Users }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent"><Icon className="size-5" /></span>
        <div>
          {value === undefined ? <Skeleton className="h-7 w-10" /> : <div className="text-2xl font-bold tabular">{value}</div>}
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  )
}

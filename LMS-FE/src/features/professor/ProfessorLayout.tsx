import { lazy, Suspense, useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router'
import { Activity, BarChart3, CalendarPlus, Camera, FileText, LogOut, Users } from 'lucide-react'
import { Brand } from '@/components/Brand'
import { NotificationBell } from '@/components/NotificationBell'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useIdleLogout } from '@/hooks/useIdleLogout'
import { useNotificationSocket } from '@/hooks/useNotificationSocket'
import { cn, initials } from '@/lib/utils'
import { professorApi } from '@/services/professorApi'
import { useAppDispatch, useAppSelector } from '@/store'
import { professorAvatarSet, professorLoggedOut } from '@/store/authSlice'

// The cropper is only needed when changing the photo
const AvatarCropDialog = lazy(() => import('@/components/AvatarCropDialog').then((m) => ({ default: m.AvatarCropDialog })))

const NAV = [
  { to: 'content', label: 'Content', icon: FileText },
  { to: 'events', label: 'Events', icon: CalendarPlus },
  { to: 'roster', label: 'Roster', icon: Users },
  { to: 'results', label: 'Results', icon: BarChart3 },
  { to: 'live', label: 'Live', icon: Activity },
]

export default function ProfessorLayout() {
  const professor = useAppSelector((s) => s.auth.professor)!
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const [photoOpen, setPhotoOpen] = useState(false)
  useNotificationSocket({ role: 'professor', id: professor.id })

  // Validate a persisted token once; the 401 interceptor signs out if it expired
  useEffect(() => { professorApi.me().catch(() => {}) }, [])

  const logout = () => { dispatch(professorLoggedOut()); navigate('/?role=professor') }
  const idle = useIdleLogout(true, logout)

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 lg:px-6">
          <Brand subtitle="Professor dashboard" />
          <div className="flex items-center gap-1.5">
            <NotificationBell />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2.5 rounded-full p-1 pr-3 hover:bg-muted cursor-pointer" aria-label="Account menu">
                  <Avatar>
                    {professor.avatar && <AvatarImage src={professor.avatar} alt="" />}
                    <AvatarFallback>{initials(professor.displayName || 'P')}</AvatarFallback>
                  </Avatar>
                  <span className="hidden text-sm font-semibold sm:inline">{professor.displayName}</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Signed in as {professor.displayName}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setPhotoOpen(true)}><Camera />Change photo</DropdownMenuItem>
                <DropdownMenuItem onSelect={logout}><LogOut />Sign out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 pb-2 lg:px-6" aria-label="Dashboard sections">
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

      <main className="mx-auto max-w-6xl px-4 py-8 lg:px-6"><Outlet /></main>

      {photoOpen && (
        <Suspense fallback={null}>
          <AvatarCropDialog open={photoOpen} onOpenChange={setPhotoOpen} onSave={(url) => dispatch(professorAvatarSet(url))} />
        </Suspense>
      )}

      <Dialog open={idle.warning}>
        <DialogContent hideClose onEscapeKeyDown={(e) => e.preventDefault()} onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Still there?</DialogTitle>
            <DialogDescription>
              For security you’ll be signed out in <span className="font-semibold text-foreground tabular">{idle.remaining}s</span> due to inactivity.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={logout}>Sign out now</Button>
            <Button onClick={idle.stayActive}>Stay signed in</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

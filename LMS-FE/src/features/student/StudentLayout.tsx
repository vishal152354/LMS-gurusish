import { Link, Outlet, useLocation, useNavigate } from 'react-router'
import { LogOut } from 'lucide-react'
import { Brand } from '@/components/Brand'
import { NotificationBell } from '@/components/NotificationBell'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { useNotificationSocket } from '@/hooks/useNotificationSocket'
import { initials } from '@/lib/utils'
import { useAppDispatch, useAppSelector } from '@/store'
import { studentLoggedOut } from '@/store/authSlice'

export default function StudentLayout() {
  const student = useAppSelector((s) => s.auth.student)!
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const inTest = useLocation().pathname.includes('/test/')
  useNotificationSocket({ role: 'student', id: student.roll })

  return (
    <div className="min-h-screen">
      {!inTest && (
        <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-xl">
          <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-3 px-4">
            <Link to="/student" aria-label="My tests"><Brand /></Link>
            <div className="flex items-center gap-2">
              <NotificationBell />
              <div className="hidden items-center gap-2.5 sm:flex">
                <Avatar><AvatarFallback>{initials(student.name)}</AvatarFallback></Avatar>
                <div className="leading-tight">
                  <div className="text-sm font-semibold">{student.name}</div>
                  <div className="text-xs text-muted-foreground tabular">{student.roll}</div>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => { dispatch(studentLoggedOut()); navigate('/') }}>
                <LogOut />Sign out
              </Button>
            </div>
          </div>
        </header>
      )}
      <Outlet />
    </div>
  )
}

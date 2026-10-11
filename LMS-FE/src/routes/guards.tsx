import { Navigate, Outlet, useLocation } from 'react-router'
import { useAppSelector } from '@/store'

export function RequireStudent() {
  const student = useAppSelector((s) => s.auth.student)
  const loc = useLocation()
  return student ? <Outlet /> : <Navigate to="/" replace state={{ from: loc.pathname }} />
}

export function RequireAdmin() {
  const admin = useAppSelector((s) => s.auth.admin)
  const loc = useLocation()
  return admin ? <Outlet /> : <Navigate to="/?role=admin" replace state={{ from: loc.pathname }} />
}

export function RequireProfessor() {
  const professor = useAppSelector((s) => s.auth.professor)
  const loc = useLocation()
  return professor ? <Outlet /> : <Navigate to="/?role=teacher" replace state={{ from: loc.pathname }} />
}

/** /professor/... links from before the rename go to the same page under /teacher. */
export function LegacyTeacherRedirect() {
  const { pathname, search } = useLocation()
  return <Navigate to={pathname.replace(/^\/professor/, '/teacher') + search} replace />
}

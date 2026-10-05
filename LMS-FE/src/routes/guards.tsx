import { Navigate, Outlet, useLocation } from 'react-router'
import { useAppSelector } from '@/store'

export function RequireStudent() {
  const student = useAppSelector((s) => s.auth.student)
  const loc = useLocation()
  return student ? <Outlet /> : <Navigate to="/" replace state={{ from: loc.pathname }} />
}

export function RequireProfessor() {
  const professor = useAppSelector((s) => s.auth.professor)
  const loc = useLocation()
  return professor ? <Outlet /> : <Navigate to="/?role=professor" replace state={{ from: loc.pathname }} />
}

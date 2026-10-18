import { lazy, Suspense, type ReactNode } from 'react'
import { createBrowserRouter, Navigate } from 'react-router'
import { LegacyTeacherRedirect, RequireAdmin, RequireProfessor, RequireStudent } from './guards'
import { FullPageSpinner } from '@/components/FullPageSpinner'
import { RouteError } from '@/components/RouteError'
import LoginPage from '@/features/auth/LoginPage'
import StudentLayout from '@/features/student/StudentLayout'
import ProfessorLayout from '@/features/professor/ProfessorLayout'

// Heavier screens load on demand
const TestsPage = lazy(() => import('@/features/student/TestsPage'))
const TakeTestPage = lazy(() => import('@/features/student/TakeTestPage'))
const ResultPage = lazy(() => import('@/features/student/ResultPage'))
const ContentPage = lazy(() => import('@/features/professor/ContentPage'))
const EventsPage = lazy(() => import('@/features/professor/EventsPage'))
const RosterPage = lazy(() => import('@/features/professor/RosterPage'))
const ResultsPage = lazy(() => import('@/features/professor/ResultsPage'))
const LivePage = lazy(() => import('@/features/professor/LivePage'))
const AdminLayout = lazy(() => import('@/features/admin/AdminLayout'))
const TeachersPage = lazy(() => import('@/features/admin/TeachersPage'))
const StudentsPage = lazy(() => import('@/features/admin/StudentsPage'))
const AdminContentPage = lazy(() => import('@/features/admin/ContentPage'))
const ResultsListPage = lazy(() => import('@/features/admin/ResultsListPage'))
const TestResultsPage = lazy(() => import('@/features/admin/TestResultsPage'))

const s = (el: ReactNode) => <Suspense fallback={<FullPageSpinner />}>{el}</Suspense>

export const router = createBrowserRouter([
  { path: '/', element: <LoginPage />, errorElement: <RouteError /> },
  {
    element: <RequireStudent />,
    errorElement: <RouteError />,
    children: [
      {
        path: '/student',
        element: <StudentLayout />,
        children: [
          { index: true, element: s(<TestsPage />) },
          { path: 'test/:eventId', element: s(<TakeTestPage />) },
          { path: 'result/:eventId', element: s(<ResultPage />) },
        ],
      },
    ],
  },
  {
    element: <RequireProfessor />,
    errorElement: <RouteError />,
    children: [
      {
        path: '/teacher',
        element: <ProfessorLayout />,
        children: [
          { index: true, element: <Navigate to="content" replace /> },
          { path: 'content', element: s(<ContentPage />) },
          { path: 'events', element: s(<EventsPage />) },
          { path: 'roster', element: s(<RosterPage />) },
          { path: 'results', element: s(<ResultsPage />) },
          { path: 'live', element: s(<LivePage />) },
        ],
      },
    ],
  },
  {
    element: <RequireAdmin />,
    errorElement: <RouteError />,
    children: [
      {
        path: '/admin',
        element: s(<AdminLayout />),
        children: [
          { index: true, element: <Navigate to="content" replace /> },
          { path: 'content', element: s(<AdminContentPage />) },
          { path: 'teachers', element: s(<TeachersPage />) },
          { path: 'students', element: s(<StudentsPage />) },
          { path: 'results', element: s(<ResultsListPage />) },
          { path: 'results/:eventId', element: s(<TestResultsPage />) },
        ],
      },
    ],
  },
  // old links from before the rename
  { path: '/professor/*', element: <LegacyTeacherRedirect /> },
  { path: '*', element: <RouteError notFound /> },
])

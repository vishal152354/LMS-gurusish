import { http } from './http'
import type { AdminLogin, AdminStats, ManagedStudent, StudentImportResult, Teacher } from '@/types/api'

export const adminApi = {
  login: (username: string, password: string) =>
    http.post<AdminLogin>('/admin/login', { username, password }).then((r) => r.data),
  stats: () => http.get<AdminStats>('/admin/stats').then((r) => r.data),

  // teachers
  listTeachers: () => http.get<Teacher[]>('/admin/teachers').then((r) => r.data),
  createTeacher: (input: { username: string; password: string; display_name: string }) =>
    http.post<Teacher>('/admin/teachers', input).then((r) => r.data),
  resetTeacherPassword: (id: string, password: string) =>
    http.post(`/admin/teachers/${encodeURIComponent(id)}/password`, { password }).then((r) => r.data),
  deleteTeacher: (id: string) => http.delete(`/admin/teachers/${encodeURIComponent(id)}`).then((r) => r.data),

  // students
  listStudents: () => http.get<ManagedStudent[]>('/admin/students').then((r) => r.data),
  createStudent: (input: { roll_number: string; name: string }) =>
    http.post<ManagedStudent>('/admin/students', input).then((r) => r.data),
  importStudents: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return http.post<StudentImportResult>('/admin/students/import', fd).then((r) => r.data)
  },
  deleteStudent: (id: string) => http.delete(`/admin/students/${encodeURIComponent(id)}`).then((r) => r.data),
}

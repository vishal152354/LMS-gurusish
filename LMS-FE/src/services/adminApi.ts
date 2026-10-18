import { http } from './http'
import type { AdminLogin, AdminStats, AdminTest, ContentItem, EventResults, ManagedStudent, PipelineStatus, Teacher } from '@/types/api'

export const adminApi = {
  login: (username: string, password: string) =>
    http.post<AdminLogin>('/admin/login', { username, password }).then((r) => r.data),
  stats: () => http.get<AdminStats>('/admin/stats').then((r) => r.data),

  // content library (teachers build tests from it)
  listContent: () => http.get<ContentItem[]>('/admin/content').then((r) => r.data),
  uploadContent: (file: File, token: string, onProgress?: (pct: number) => void) => {
    const fd = new FormData()
    fd.append('token', token)
    fd.append('file', file)
    return http.post<{ upload_id: string; filename: string }>('/admin/content/upload', fd, {
      timeout: 0,
      onUploadProgress: (e) => e.total && onProgress?.(Math.round((e.loaded / e.total) * 100)),
    }).then((r) => r.data)
  },
  pipelineStatus: (upload_id: string) =>
    http.get<PipelineStatus>(`/student/pipeline/status/${encodeURIComponent(upload_id)}`).then((r) => r.data),
  renameContent: (upload_id: string, display_name: string) =>
    http.patch(`/admin/content/${encodeURIComponent(upload_id)}`, { display_name }).then((r) => r.data),
  deleteContent: (upload_id: string) => http.delete(`/admin/content/${encodeURIComponent(upload_id)}`).then((r) => r.data),

  // teachers
  listTeachers: () => http.get<Teacher[]>('/admin/teachers').then((r) => r.data),
  resetTeacherPassword: (id: string, password: string) =>
    http.post(`/admin/teachers/${encodeURIComponent(id)}/password`, { password }).then((r) => r.data),
  deleteTeacher: (id: string) => http.delete(`/admin/teachers/${encodeURIComponent(id)}`).then((r) => r.data),

  // students
  listStudents: () => http.get<ManagedStudent[]>('/admin/students').then((r) => r.data),
  deleteStudent: (id: string) => http.delete(`/admin/students/${encodeURIComponent(id)}`).then((r) => r.data),

  // test results (every teacher's tests)
  listTests: () => http.get<AdminTest[]>('/admin/tests').then((r) => r.data),
  testResults: (event_id: string) =>
    http.get<EventResults>(`/admin/tests/${encodeURIComponent(event_id)}/results`).then((r) => r.data),
  exportUrl: (event_id: string, token: string) =>
    `${http.defaults.baseURL ?? ''}/admin/tests/${encodeURIComponent(event_id)}/export?token=${encodeURIComponent(token)}`,
}

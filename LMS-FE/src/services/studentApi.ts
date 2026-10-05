import { http } from './http'
import type { AnswerResponse, JoinResponse, StartTestResponse, StoredResult, StudentTest } from '@/types/api'

export const studentApi = {
  join: (roll_number: string, name: string) =>
    http.post<JoinResponse>('/student/join', { roll_number, name }).then((r) => r.data),

  myTests: (roll_number: string) =>
    http.get<{ tests: StudentTest[] }>('/student/my-tests', { params: { roll_number, t: Date.now() } }).then((r) => r.data.tests),

  startTest: (student_id: string, upload_id: string, event_id: string) =>
    http.post<StartTestResponse>('/student/viva/start', { student_id, upload_id, event_id }, { timeout: 90_000 }).then((r) => r.data),

  answer: (session_id: string, letter: string) =>
    http.post<AnswerResponse>(`/student/viva/answer/${session_id}`, { answer_text: letter }).then((r) => r.data),

  logIntegrity: (session_id: string, event_type: string) =>
    http.post<{ warning_count: number; flagged: boolean }>(`/student/viva/integrity/${session_id}`, {
      event_type, timestamp: new Date().toISOString(),
    }).then((r) => r.data),

  result: (student_id: string, upload_id: string, event_id?: string) =>
    http.get<StoredResult>(`/student/result/${encodeURIComponent(student_id)}/${encodeURIComponent(upload_id)}`, {
      params: event_id ? { event_id } : undefined,
    }).then((r) => r.data),
}

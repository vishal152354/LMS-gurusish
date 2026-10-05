import { http } from './http'
import type {
  ContentItem, CreateEventInput, CreateEventResponse, EventDetail, EventResults, EventSummary,
  GenerationProgress, OrchestratorStatus, PipelineStatus, ProfessorLogin, RosterUploadResponse,
} from '@/types/api'

export const professorApi = {
  login: (username: string, password: string) =>
    http.post<ProfessorLogin>('/professor/login', { username, password }).then((r) => r.data),
  me: () => http.get<{ professor_id: string; username: string; display_name: string }>('/professor/me').then((r) => r.data),

  // content
  listContent: () => http.get<ContentItem[]>('/professor/content').then((r) => r.data),
  uploadContent: (file: File, token: string, onProgress?: (pct: number) => void) => {
    const fd = new FormData()
    fd.append('token', token)
    fd.append('file', file)
    return http.post<{ upload_id: string; filename: string }>('/professor/content/upload', fd, {
      timeout: 0,
      onUploadProgress: (e) => e.total && onProgress?.(Math.round((e.loaded / e.total) * 100)),
    }).then((r) => r.data)
  },
  pipelineStatus: (upload_id: string) =>
    http.get<PipelineStatus>(`/student/pipeline/status/${encodeURIComponent(upload_id)}`).then((r) => r.data),
  renameContent: (upload_id: string, display_name: string) =>
    http.patch(`/professor/content/${encodeURIComponent(upload_id)}`, { display_name }).then((r) => r.data),
  deleteContent: (upload_id: string) => http.delete(`/professor/content/${encodeURIComponent(upload_id)}`).then((r) => r.data),

  // events
  listEvents: () => http.get<EventSummary[]>('/professor/events').then((r) => r.data),
  getEvent: (event_id: string) => http.get<EventDetail>(`/professor/events/${event_id}`).then((r) => r.data),
  createEvent: (input: CreateEventInput) =>
    // Question generation runs inside this request and can take minutes on free models
    http.post<CreateEventResponse>('/professor/events', input, { timeout: 0 }).then((r) => r.data),
  generationProgress: (progress_id: string) =>
    http.get<GenerationProgress>(`/professor/events/progress/${encodeURIComponent(progress_id)}`).then((r) => r.data),
  deleteEvent: (event_id: string) => http.delete(`/professor/events/${event_id}`).then((r) => r.data),

  // roster + results
  uploadRoster: (event_id: string, file: File, token: string) => {
    const fd = new FormData()
    fd.append('token', token)
    fd.append('file', file)
    return http.post<RosterUploadResponse>(`/professor/events/${event_id}/roster`, fd).then((r) => r.data)
  },
  results: (event_id: string) => http.get<EventResults>(`/professor/events/${event_id}/results`).then((r) => r.data),
  exportUrl: (event_id: string, token: string) =>
    `${http.defaults.baseURL ?? ''}/professor/events/${event_id}/export?token=${encodeURIComponent(token)}`,

  // live
  liveStatus: () => http.get<OrchestratorStatus>('/orchestrator/status').then((r) => r.data),
}

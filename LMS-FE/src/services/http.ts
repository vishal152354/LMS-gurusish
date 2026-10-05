import axios, { AxiosError } from 'axios'
import { env } from '@/lib/env'

/** Shared Axios instance. The professor token is attached by an interceptor
 *  registered in store/index.ts (the backend expects it as ?token=…). */
export const http = axios.create({ baseURL: env.apiBaseUrl, timeout: 30_000 })

/** Turn any API failure into a readable sentence (FastAPI puts it in `detail`). */
export function apiError(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (err instanceof AxiosError) {
    if (err.code === 'ECONNABORTED') return 'The server took too long to respond.'
    if (!err.response) return 'Cannot reach the server. Is the backend running on port 7860?'
    const detail = (err.response.data as { detail?: unknown })?.detail
    if (typeof detail === 'string') return detail
    if (Array.isArray(detail)) return detail.map((d) => d?.msg ?? '').filter(Boolean).join('; ') || fallback
  }
  return err instanceof Error ? err.message : fallback
}

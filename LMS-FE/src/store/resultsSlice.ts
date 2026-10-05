import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { FinalResult } from '@/types/api'

/** Full results of tests the student finished on this device, keyed by event id.
 *  The backend's stored result has no per-question detail for older attempts,
 *  so keeping the final payload lets the result page show the full breakdown. */
interface ResultsState { byEvent: Record<string, FinalResult & { finishedAt: string; title?: string }> }

const resultsSlice = createSlice({
  name: 'results',
  initialState: { byEvent: {} } as ResultsState,
  reducers: {
    resultSaved: (s, a: PayloadAction<{ eventId: string; result: FinalResult; title?: string }>) => {
      s.byEvent[a.payload.eventId] = { ...a.payload.result, title: a.payload.title, finishedAt: new Date().toISOString() }
    },
  },
})

export const { resultSaved } = resultsSlice.actions
export default resultsSlice.reducer

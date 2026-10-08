import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

/** Ellie's state: whether she's switched on, and which page tours have been seen. */
interface GuideState { enabled: boolean; seen: Record<string, true> }

const guideSlice = createSlice({
  name: 'guide',
  initialState: { enabled: true, seen: {} } as GuideState,
  reducers: {
    tourSeen: (s, a: PayloadAction<string>) => { s.seen[a.payload] = true },
    toursReset: (s) => { s.seen = {} },
    guideToggled: (s, a: PayloadAction<boolean>) => { s.enabled = a.payload },
  },
})

export const { tourSeen, toursReset, guideToggled } = guideSlice.actions
export default guideSlice.reducer

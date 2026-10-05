import { createSlice, isAnyOf, type PayloadAction } from '@reduxjs/toolkit'
import { professorLoggedIn, professorLoggedOut, studentLoggedIn, studentLoggedOut } from './authSlice'

export interface AppNotification {
  id: string
  type: 'info' | 'success' | 'warning' | 'error'
  title: string
  message?: string
  at: string
  read: boolean
}

const MAX = 50

const notificationsSlice = createSlice({
  name: 'notifications',
  initialState: { items: [] as AppNotification[], connected: false },
  reducers: {
    notificationReceived: (s, a: PayloadAction<Omit<AppNotification, 'read'>>) => {
      s.items.unshift({ ...a.payload, read: false })
      s.items = s.items.slice(0, MAX)
    },
    notificationsRead: (s) => { s.items.forEach((n) => { n.read = true }) },
    notificationsCleared: (s) => { s.items = [] },
    socketStatusChanged: (s, a: PayloadAction<boolean>) => { s.connected = a.payload },
  },
  // Notifications belong to whoever is signed in — start fresh on every sign-in/out
  extraReducers: (b) => {
    b.addMatcher(isAnyOf(studentLoggedIn, studentLoggedOut, professorLoggedIn, professorLoggedOut), (s) => { s.items = [] })
  },
})

export const { notificationReceived, notificationsRead, notificationsCleared, socketStatusChanged } = notificationsSlice.actions
export default notificationsSlice.reducer

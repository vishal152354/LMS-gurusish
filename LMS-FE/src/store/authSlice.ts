import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

export interface StudentSession { id: string; roll: string; name: string }
export interface ProfessorSession { token: string; id: string; displayName: string; avatar?: string | null }

interface AuthState {
  student: StudentSession | null
  professor: ProfessorSession | null
}

const initialState: AuthState = { student: null, professor: null }

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    studentLoggedIn: (s, a: PayloadAction<StudentSession>) => { s.student = a.payload },
    studentLoggedOut: (s) => { s.student = null },
    professorLoggedIn: (s, a: PayloadAction<ProfessorSession>) => { s.professor = { ...a.payload, avatar: s.professor?.avatar ?? null } },
    professorLoggedOut: (s) => { s.professor = null },
    professorAvatarSet: (s, a: PayloadAction<string | null>) => { if (s.professor) s.professor.avatar = a.payload },
  },
})

export const { studentLoggedIn, studentLoggedOut, professorLoggedIn, professorLoggedOut, professorAvatarSet } = authSlice.actions
export default authSlice.reducer

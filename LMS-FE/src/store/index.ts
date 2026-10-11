import { combineReducers, configureStore, type Reducer } from '@reduxjs/toolkit'
import { useDispatch, useSelector } from 'react-redux'
import {
  persistReducer, persistStore, FLUSH, PAUSE, PERSIST, PURGE, REGISTER, REHYDRATE,
} from 'redux-persist'
import storage from 'redux-persist/lib/storage'
import { createTransform } from 'redux-persist'
import auth, { adminLoggedOut, professorLoggedOut } from './authSlice'
import results from './resultsSlice'
import notifications from './notificationsSlice'
import guide from './guideSlice'
import { http } from '@/services/http'

// Persist auth, saved results and notifications — but not the live socket flag.
const dropConnected = createTransform(
  (inbound: { items: unknown; connected: boolean }) => ({ ...inbound, connected: false }),
  (outbound: { items: unknown; connected: boolean }) => ({ ...outbound, connected: false }),
  { whitelist: ['notifications'] },
)

const rootReducer = combineReducers({ auth, results, notifications, guide })
export type RootState = ReturnType<typeof rootReducer>
// redux-persist's types predate RTK 2; the persisted reducer has the same state shape
const persisted = persistReducer(
  { key: 'pariksha', version: 1, storage, whitelist: ['auth', 'results', 'notifications', 'guide'], transforms: [dropConnected] },
  rootReducer as unknown as Reducer<RootState>,
) as unknown as typeof rootReducer

export const store = configureStore({
  reducer: persisted,
  middleware: (getDefault) =>
    getDefault({ serializableCheck: { ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER] } }),
})
export const persistor = persistStore(store)

export type AppDispatch = typeof store.dispatch
export const useAppDispatch = useDispatch.withTypes<AppDispatch>()
export const useAppSelector = useSelector.withTypes<RootState>()

// Teacher (/professor) and admin endpoints authenticate with ?token=… — attach it centrally.
const tokenFor = (url: string) => {
  const { professor, admin } = store.getState().auth
  if (url.startsWith('/professor') && !url.startsWith('/professor/login')) return professor?.token
  if (url.startsWith('/admin') && !url.startsWith('/admin/login')) return admin?.token
  return undefined
}
http.interceptors.request.use((config) => {
  const token = tokenFor(config.url ?? '')
  if (token) config.params = { ...(config.params ?? {}), token }
  return config
})

// An expired token signs that teacher or admin out everywhere.
http.interceptors.response.use(undefined, (error) => {
  const url: string = error?.config?.url ?? ''
  if (error?.response?.status === 401) {
    if (url.startsWith('/professor') && !url.startsWith('/professor/login')) store.dispatch(professorLoggedOut())
    if (url.startsWith('/admin') && !url.startsWith('/admin/login')) store.dispatch(adminLoggedOut())
  }
  return Promise.reject(error)
})

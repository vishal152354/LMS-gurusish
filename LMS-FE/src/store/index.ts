import { combineReducers, configureStore, type Reducer } from '@reduxjs/toolkit'
import { useDispatch, useSelector } from 'react-redux'
import {
  persistReducer, persistStore, FLUSH, PAUSE, PERSIST, PURGE, REGISTER, REHYDRATE,
} from 'redux-persist'
import storage from 'redux-persist/lib/storage'
import { createTransform } from 'redux-persist'
import auth, { professorLoggedOut } from './authSlice'
import results from './resultsSlice'
import notifications from './notificationsSlice'
import { http } from '@/services/http'

// Persist auth, saved results and notifications — but not the live socket flag.
const dropConnected = createTransform(
  (inbound: { items: unknown; connected: boolean }) => ({ ...inbound, connected: false }),
  (outbound: { items: unknown; connected: boolean }) => ({ ...outbound, connected: false }),
  { whitelist: ['notifications'] },
)

const rootReducer = combineReducers({ auth, results, notifications })
export type RootState = ReturnType<typeof rootReducer>
// redux-persist's types predate RTK 2; the persisted reducer has the same state shape
const persisted = persistReducer(
  { key: 'pariksha', version: 1, storage, whitelist: ['auth', 'results', 'notifications'], transforms: [dropConnected] },
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

// Professor endpoints authenticate with ?token=… — attach it centrally.
http.interceptors.request.use((config) => {
  const token = store.getState().auth.professor?.token
  const url = config.url ?? ''
  if (token && (url.startsWith('/professor') && !url.startsWith('/professor/login'))) {
    config.params = { ...(config.params ?? {}), token }
  }
  return config
})

// An expired professor token logs the professor out everywhere.
http.interceptors.response.use(undefined, (error) => {
  const url: string = error?.config?.url ?? ''
  if (error?.response?.status === 401 && url.startsWith('/professor') && !url.startsWith('/professor/login')) {
    store.dispatch(professorLoggedOut())
  }
  return Promise.reject(error)
})

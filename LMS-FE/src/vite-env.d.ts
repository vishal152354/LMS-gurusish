/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_ENV?: string
  readonly VITE_API_BASE_URL?: string
  readonly VITE_SOCKET_URL?: string
  readonly VITE_IDLE_TIMEOUT_MINUTES?: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}

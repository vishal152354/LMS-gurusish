export const env = {
  appEnv: import.meta.env.VITE_APP_ENV ?? 'development',
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? '',
  socketUrl: import.meta.env.VITE_SOCKET_URL ?? '',
  idleTimeoutMinutes: Number(import.meta.env.VITE_IDLE_TIMEOUT_MINUTES ?? 30),
}

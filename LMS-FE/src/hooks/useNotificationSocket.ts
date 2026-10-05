import { useEffect } from 'react'
import { io } from 'socket.io-client'
import { toast } from 'sonner'
import { env } from '@/lib/env'
import { uuid } from '@/lib/utils'
import { useAppDispatch } from '@/store'
import { notificationReceived, socketStatusChanged, type AppNotification } from '@/store/notificationsSlice'

type Identity = { role: 'student' | 'professor'; id: string } | null

/** Connects to the notification server (see test-server/) while someone is
 *  signed in, and turns every `notification` event into a toast + bell entry. */
export function useNotificationSocket(identity: Identity) {
  const dispatch = useAppDispatch()
  const role = identity?.role
  const id = identity?.id

  useEffect(() => {
    if (!role || !id || !env.socketUrl) return
    const socket = io(env.socketUrl, {
      auth: { role, id },
      transports: ['websocket'],
      reconnectionDelayMax: 10_000,
    })
    socket.on('connect', () => dispatch(socketStatusChanged(true)))
    socket.on('disconnect', () => dispatch(socketStatusChanged(false)))
    socket.on('connect_error', () => dispatch(socketStatusChanged(false)))
    socket.on('notification', (raw: Partial<AppNotification>) => {
      const n = {
        id: raw.id ?? uuid(),
        type: raw.type ?? 'info',
        title: raw.title ?? 'Notification',
        message: raw.message,
        at: raw.at ?? new Date().toISOString(),
      } as Omit<AppNotification, 'read'>
      dispatch(notificationReceived(n))
      const show = n.type === 'success' ? toast.success : n.type === 'error' ? toast.error : n.type === 'warning' ? toast.warning : toast.info
      show(n.title, { description: n.message })
    })
    return () => { socket.disconnect(); dispatch(socketStatusChanged(false)) }
  }, [role, id, dispatch])
}

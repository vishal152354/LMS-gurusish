import moment from 'moment'
import { Bell, CheckCheck, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useAppDispatch, useAppSelector } from '@/store'
import { notificationsCleared, notificationsRead } from '@/store/notificationsSlice'

const DOT: Record<string, string> = { success: 'bg-success', error: 'bg-destructive', warning: 'bg-warning', info: 'bg-accent' }

export function NotificationBell() {
  const dispatch = useAppDispatch()
  const { items, connected } = useAppSelector((s) => s.notifications)
  const unread = items.filter((n) => !n.read).length

  return (
    <DropdownMenu onOpenChange={(open) => { if (!open && unread) dispatch(notificationsRead()) }}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="relative" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
              <Bell />
              {unread > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-accent-foreground tabular">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{connected ? 'Live notifications connected' : 'Notifications offline'}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>Notifications</span>
          <span className={cn('flex items-center gap-1.5 font-normal', connected ? 'text-success-text' : 'text-subtle-foreground')}>
            <span className={cn('size-1.5 rounded-full', connected ? 'bg-success' : 'bg-subtle-foreground')} />
            {connected ? 'Live' : 'Offline'}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {items.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">You’re all caught up.</p>
        ) : (
          <div className="max-h-80 overflow-y-auto">
            {items.map((n) => (
              <div key={n.id} className="flex gap-3 rounded-sm px-2.5 py-2.5">
                <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', DOT[n.type], n.read && 'opacity-40')} />
                <div className="min-w-0">
                  <p className={cn('text-sm', !n.read && 'font-semibold')}>{n.title}</p>
                  {n.message && <p className="mt-0.5 text-xs text-muted-foreground">{n.message}</p>}
                  <p className="mt-1 text-[11px] text-subtle-foreground">{moment(n.at).fromNow()}</p>
                </div>
              </div>
            ))}
          </div>
        )}
        {items.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <div className="flex">
              <DropdownMenuItem className="flex-1" onSelect={() => dispatch(notificationsRead())}><CheckCheck />Mark all read</DropdownMenuItem>
              <DropdownMenuItem className="flex-1" onSelect={() => dispatch(notificationsCleared())}><Trash2 />Clear</DropdownMenuItem>
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

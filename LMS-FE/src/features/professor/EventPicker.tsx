import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import moment from 'moment'
import { toast } from 'sonner'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { apiError } from '@/services/http'
import { professorApi } from '@/services/professorApi'
import type { EventSummary } from '@/types/api'

/** Event selector kept in the URL (?event=…) so views are linkable and survive reloads. */
export function useSelectedEvent() {
  const [params, setParams] = useSearchParams()
  const [events, setEvents] = useState<EventSummary[] | null>(null)
  const eventId = params.get('event') ?? ''

  useEffect(() => {
    professorApi.listEvents().then(setEvents).catch((e) => { toast.error(apiError(e)); setEvents([]) })
  }, [])

  // Default to the most recent event
  useEffect(() => {
    if (!eventId && events?.length) setParams({ event: events[0].event_id }, { replace: true })
  }, [eventId, events, setParams])

  return {
    events,
    eventId,
    event: events?.find((e) => e.event_id === eventId) ?? null,
    select: (id: string) => setParams({ event: id }, { replace: true }),
    reload: () => professorApi.listEvents().then(setEvents).catch(() => {}),
  }
}

export function EventPicker({ events, value, onChange }: { events: EventSummary[] | null; value: string; onChange: (id: string) => void }) {
  return (
    <div className="flex w-full max-w-sm flex-col gap-2" data-tour="results-event">
      <Label htmlFor="event-picker">Event</Label>
      <Select value={value} onValueChange={onChange} disabled={!events?.length}>
        <SelectTrigger id="event-picker"><SelectValue placeholder={events === null ? 'Loading…' : 'No events yet'} /></SelectTrigger>
        <SelectContent>
          {events?.map((e) => (
            <SelectItem key={e.event_id} value={e.event_id}>{e.title} · {moment(e.event_date).format('D MMM')}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

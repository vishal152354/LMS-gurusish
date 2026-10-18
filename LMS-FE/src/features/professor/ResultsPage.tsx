import { useState } from 'react'
import { PageHeader } from '@/components/PageHeader'
import { ResultsBoard } from '@/components/results/ResultsBoard'
import { useTour } from '@/features/guide/guideContext'
import { professorApi } from '@/services/professorApi'
import { useAppSelector } from '@/store'
import { EventPicker, useSelectedEvent } from './EventPicker'

export default function ResultsPage() {
  const token = useAppSelector((s) => s.auth.professor!.token)
  const { events, eventId, select } = useSelectedEvent()
  const [hasRows, setHasRows] = useState(false)
  useTour('prof-results', hasRows)

  return (
    <div className="animate-fade-up">
      <PageHeader title="Results" description="Click a student’s name to see how they answered." />
      <EventPicker events={events} value={eventId} onChange={select} />
      {eventId && (
        <ResultsBoard eventId={eventId} fetchResults={professorApi.results} exportHref={professorApi.exportUrl(eventId, token)}
          onLoaded={(rows) => setHasRows(rows.length > 0)} />
      )}
      {events?.length === 0 && <p className="mt-8 text-sm text-muted-foreground">No events yet.</p>}
    </div>
  )
}

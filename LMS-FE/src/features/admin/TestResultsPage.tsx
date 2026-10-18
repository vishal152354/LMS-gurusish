import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import moment from 'moment'
import { ArrowLeft, CalendarDays, FileText, Presentation } from 'lucide-react'
import { ResultsBoard } from '@/components/results/ResultsBoard'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { adminApi } from '@/services/adminApi'
import { useAppSelector } from '@/store'
import type { AdminTest, QuestionType } from '@/types/api'

const SHORT: Record<QuestionType, string> = { mcq: 'MCQ', fill_blank: 'fill-in', match: 'match' }

export default function TestResultsPage() {
  const { eventId = '' } = useParams()
  const token = useAppSelector((s) => s.auth.admin!.token)
  const [test, setTest] = useState<AdminTest | null | undefined>(undefined)

  useEffect(() => {
    adminApi.listTests().then((ts) => setTest(ts.find((t) => t.event_id === eventId) ?? null)).catch(() => setTest(null))
  }, [eventId])

  return (
    <div className="animate-fade-up">
      <Link to="/admin/results" className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline underline-offset-4">
        <ArrowLeft className="size-4" />All test results
      </Link>
      {test === undefined ? (
        <Skeleton className="mt-4 h-16 w-2/3" />
      ) : test === null ? (
        <p className="mt-6 text-sm text-muted-foreground">This test no longer exists.</p>
      ) : (
        <div className="mt-3">
          <h1 className="font-display text-2xl font-semibold sm:text-3xl">{test.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge><Presentation className="size-3" />{test.teacher_name}</Badge>
            <Badge><FileText className="size-3" />{test.content_name}</Badge>
            <Badge><CalendarDays className="size-3" />{moment(test.event_date).format('D MMM YYYY')}</Badge>
            <Badge variant="accent">
              {test.num_questions} questions · {test.total_marks} marks
            </Badge>
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {(Object.keys(SHORT) as QuestionType[]).filter((k) => test.question_types[k])
              .map((k) => `${test.question_types[k]} ${SHORT[k]} × ${test.type_marks[k]}`).join(' · ')}
          </p>
        </div>
      )}
      {test && <ResultsBoard eventId={eventId} fetchResults={adminApi.testResults} exportHref={adminApi.exportUrl(eventId, token)} />}
    </div>
  )
}

// Shapes returned by the Pariksha FastAPI backend (viva-webapp/backend).

// ── Student ────────────────────────────────────────────────
export interface JoinResponse {
  student_id: string
  name: string
  is_returning: boolean
}

export interface StudentTest {
  event_id: string
  title: string
  upload_id: string
  filename: string
  ready: boolean
  num_questions: number
  max_marks: number
  attempted: boolean
  score: number | null
  grade: string | null
}

export interface Flashcard {
  question: string
  correct_letter: string
  correct_option: string
  explanation: string
  was_correct: boolean
}

export type QuestionType = 'mcq' | 'fill_blank' | 'match'

/** A question as the student sees it during the test — never includes the answer. */
export type QuestionView =
  | { type: 'mcq'; question: string; options: string[] }
  | { type: 'fill_blank'; question: string }
  | { type: 'match'; question: string; left: string[]; right: string[] }

export interface MatchPair { left: string; chosen: string | null; correct: string; ok: boolean }

/** One answered question, released only once the whole test is submitted. */
export interface QuestionLogEntry {
  question_number: number
  type?: QuestionType           // absent on older (MCQ-only) attempts
  question: string
  options?: string[]
  selected_index?: number | null
  correct_index?: number
  correct_option: string
  student_answer?: string | null
  correct_answer?: string
  pairs?: MatchPair[]
  is_correct: boolean
  explanation: string
  marks_awarded: number
  max_marks?: number
}

export interface StartTestResponse {
  session_id: string
  greeting_text: string
  first_question_text: string
  options: string[]
  question: QuestionView
  question_number: number
  total_questions: number
  marks_per_question: number
  total_marks: number
  current_node: string
}

export interface FinalResult {
  final_marks: number
  max_marks: number
  percent: number
  grade: string
  feedback: string
  strong_areas: string[]
  areas_to_improve: string[]
  closing_text: string
  viva_complete: true
  correct_count: number
  total_questions: number
  marks_per_question: number
  student_name: string
  filename: string
  upload_id: string
  question_log: QuestionLogEntry[]
}

/** Before the last question: just the next question — no correctness, no score. */
export interface AnswerNext {
  accepted: true
  viva_complete: false
  question: QuestionView
  question_number: number
  total_questions: number
  answered: number
}

export type AnswerResponse = AnswerNext | FinalResult

export interface AnswerInput { answer_text?: string; match?: (number | null)[] }
/** GET /student/result/{student_id}/{upload_id} */
export interface StoredResult {
  student_name: string
  roll_number: string
  filename: string
  date: string
  final_marks: number
  grade: string
  strong_areas: string[]
  areas_to_improve: string[]
  overall_comment: string
  question_log?: QuestionLogEntry[]
  max_marks?: number
  total_questions?: number
}

// ── Professor ──────────────────────────────────────────────
export interface ProfessorLogin {
  token: string
  professor_id: string
  display_name: string
}

export interface ContentItem {
  upload_id: string
  filename: string
  display_name: string
  okf_ready: boolean
  uploaded_at: string
  step: number
  percentage: number
  label: string
}

export interface PipelineStatus {
  step: number
  step_name: string
  percentage: number
  okf_ready: boolean
  message: string
}

export interface EventSummary {
  event_id: string
  title: string
  upload_id: string
  content_name: string
  event_date: string
  status: string
  max_students: number
  num_questions: number
  question_types?: Record<QuestionType, number>
  marks_per_question: number
  roster_count: number
  completed: number
  created_at: string
}

export interface RosterEntry {
  id: string
  event_id: string
  roll_number: string
  name: string | null
  email: string | null
  added_at: string
}

export interface EventDetail {
  event_id: string
  title: string
  event_date: string
  status: string
  upload_id: string
  roster: RosterEntry[]
}

export interface CreateEventInput {
  upload_id: string
  title: string
  question_types: Record<QuestionType, number>
  marks_per_question: number
  event_date?: string
  progress_id?: string
}

export interface CreateEventResponse {
  event_id: string
  num_questions: number
  question_types: Record<QuestionType, number>
  requested: Record<QuestionType, number>
  marks_per_question: number
  total_marks: number
}

export type GenerationStage = 'pending' | 'reading' | 'generating' | 'checking' | 'saving' | 'done' | 'failed'
export interface GenerationProgress {
  stage: GenerationStage
  attempt: number
  done?: number      // batches finished
  total?: number     // batches in this paper
  generated?: number
}

export interface RosterUploadResponse {
  added: number
  notified: number
  skipped?: number
  warning?: string
}

export interface AnswerBreakdown {
  correct: number
  wrong: number
  unanswered: number
  questions: {
    number: number; type?: QuestionType; question: string; chosen: string | null; correct_option: string
    is_correct: boolean; marks_awarded?: number; max_marks?: number; pairs?: MatchPair[] | null
  }[] | null
}

export type ResultStatus = 'Completed' | 'In Progress' | 'Pending' | 'No Show' | 'Not Booked' | 'Not Attempted'
export interface ResultRow {
  roll_number: string
  student_name: string
  topic: string
  status: ResultStatus
  total: number | string
  max_marks: number
  grade: string
  breakdown: AnswerBreakdown | null
}

export interface EventResults {
  event_id: string
  title: string
  results: ResultRow[]
}

export interface LiveSession {
  session_id: string
  roll_number: string
  student_name: string
  event_id: string
  upload_id: string
  started_at: string
  question_number: number
  score_so_far: number
  status: string
}

export interface OrchestratorStatus {
  active_count: number
  reserved_count: number
  slots_used: number
  available_slots: number
  active_sessions: LiveSession[]
  queue: { roll_number: string; student_name: string; position: number }[]
  queue_length: number
}

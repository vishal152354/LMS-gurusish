import { useEffect, useRef, useState } from 'react'
import { professorApi } from '@/services/professorApi'
import type { GenerationStage } from '@/types/api'

// Each backend stage owns a slice of the bar. While a stage runs (the AI call can
// take a minute) the bar eases toward the top of its slice, so it keeps moving
// without ever claiming more progress than the backend has reported.
const SLICES: Record<string, [number, number]> = {
  pending: [0, 4], reading: [4, 10], checking: [88, 94], saving: [94, 99],
}
const ATTEMPT_SLICES: Record<number, [number, number]> = { 1: [10, 72], 2: [72, 82], 3: [82, 88] }

export const GEN_STEPS = [
  { stage: 'reading', label: 'Read content' },
  { stage: 'generating', label: 'Write questions' },
  { stage: 'checking', label: 'Check' },
  { stage: 'saving', label: 'Save' },
] as const

export function generationLabel(stage: GenerationStage, attempt: number, n: number, done = 0, total = 0) {
  switch (stage) {
    case 'reading': return 'Reading the knowledge graph…'
    case 'generating':
      if (total > 1) return `Writing ${n} questions — ${done} of ${total} batches done…`
      return attempt > 1 ? `Retrying — writing ${n} questions (attempt ${attempt} of 3)…` : `Writing ${n} questions with the AI…`
    case 'checking': return 'Checking the questions…'
    case 'saving': return 'Saving the test…'
    case 'done': return `Done — questions ready`
    case 'failed': return 'Question generation failed'
    default: return 'Starting…'
  }
}

export function useGenerationProgress(progressId: string | null) {
  const [stage, setStage] = useState<GenerationStage>('pending')
  const [attempt, setAttempt] = useState(0)
  const [batches, setBatches] = useState({ done: 0, total: 0 })
  const [pct, setPct] = useState(0)
  const stageStart = useRef(Date.now())
  const shown = useRef(0)
  const lastDone = useRef(0)

  // reset on a new run
  useEffect(() => {
    if (!progressId) return
    setStage('pending'); setAttempt(0); setBatches({ done: 0, total: 0 }); lastDone.current = 0; setPct(1); shown.current = 1; stageStart.current = Date.now()
  }, [progressId])

  // poll the backend
  useEffect(() => {
    if (!progressId || stage === 'done' || stage === 'failed') return
    let stop = false
    let timer: number
    const poll = async () => {
      try {
        const p = await professorApi.generationProgress(progressId)
        if (!stop && (p.done ?? 0) !== lastDone.current) {
          lastDone.current = p.done ?? 0
          stageStart.current = Date.now()       // ease afresh through the next batch's share
        }
        if (!stop && p.total != null) {
          setBatches((b) => (b.done === (p.done ?? 0) && b.total === p.total ? b : { done: p.done ?? 0, total: p.total! }))
        }
        if (!stop && (p.stage !== stage || p.attempt !== attempt) && p.stage !== 'pending') {
          setStage(p.stage); setAttempt(p.attempt); stageStart.current = Date.now()
        }
      } catch { /* keep animating; next poll may succeed */ }
      if (!stop) timer = window.setTimeout(poll, 800)
    }
    timer = window.setTimeout(poll, 300)
    return () => { stop = true; window.clearTimeout(timer) }
  }, [progressId, stage, attempt])

  // animate within the current slice
  useEffect(() => {
    if (!progressId || stage === 'done' || stage === 'failed') return
    const t = window.setInterval(() => {
      // Parallel batches: each finished batch owns an equal share of 10–88%;
      // the bar eases through the share of the batches still running.
      const [lo, hi] = stage === 'generating' && batches.total > 0
        ? [10 + (78 * batches.done) / batches.total, batches.done >= batches.total ? 88 : 10 + (78 * (batches.done + 1)) / batches.total]
        : stage === 'generating' ? (ATTEMPT_SLICES[attempt] ?? [10, 88]) : (SLICES[stage] ?? [0, 4])
      const secs = (Date.now() - stageStart.current) / 1000
      const target = lo + (hi - lo) * 0.95 * (1 - Math.exp(-secs / 25))
      shown.current = Math.max(shown.current, target)
      setPct(shown.current)
    }, 200)
    return () => window.clearInterval(t)
  }, [progressId, stage, attempt, batches])

  return {
    stage, attempt, pct, batches,
    finish: () => { setStage('done'); shown.current = 100; setPct(100) },
    fail: () => setStage('failed'),
  }
}

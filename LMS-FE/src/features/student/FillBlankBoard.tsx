import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'

const BLANK = '____'

/** Fill in the blank: the gap is typed into, right inside the sentence. */
export function FillBlankBoard({ question, locked, submitting, onSubmit }: {
  question: string; locked: boolean; submitting: boolean; onSubmit: (text: string) => void
}) {
  const [value, setValue] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const [before, after] = (() => {
    const i = question.indexOf(BLANK)
    return i < 0 ? [question + ' ', ''] : [question.slice(0, i), question.slice(i + BLANK.length)]
  })()

  useEffect(() => { setValue(''); const t = window.setTimeout(() => input.current?.focus(), 250); return () => window.clearTimeout(t) }, [question])

  const submit = () => { if (value.trim() && !locked) onSubmit(value.trim()) }
  const width = Math.min(26, Math.max(8, value.length + 2))

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border-2 border-dashed border-border-strong bg-white/[0.025] p-5 text-lg leading-[2.6] sm:text-xl" data-tour="answer-area">
        <span>{before}</span>
        <input
          ref={input}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit() } }}
          disabled={locked}
          aria-label="Your answer for the blank"
          autoComplete="off"
          spellCheck={false}
          style={{ width: `${width}ch` }}
          className="mx-1 inline-block rounded-md border-b-[3px] border-accent bg-accent-soft px-2 py-0.5 text-center font-semibold text-accent outline-none transition-[width] duration-150 placeholder:font-normal placeholder:text-accent/40 focus:bg-accent/20"
          placeholder="type here"
        />
        <span>{after}</span>
      </div>
      <p className="text-xs text-subtle-foreground">Type the missing word or words, then press Enter or Submit answer.</p>
      <div className="flex justify-end">
        <Button size="lg" className="w-full sm:w-auto" disabled={!value.trim() || locked} loading={submitting} onClick={submit} data-tour="submit-answer">
          {submitting ? 'Saving…' : 'Submit answer'}
        </Button>
      </div>
    </div>
  )
}

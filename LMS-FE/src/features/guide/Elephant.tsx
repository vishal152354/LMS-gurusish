import { cn } from '@/lib/utils'

export type Mood = 'idle' | 'talk' | 'cheer' | 'think'

/** Ellie — the guide. Pure SVG; every animation is CSS (see index.css, "Ellie"),
 *  and all of it stops under prefers-reduced-motion. */
export function Elephant({ mood = 'idle', size = 96, className }: { mood?: Mood; size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} className={cn('ellie', `ellie-${mood}`, className)} aria-hidden="true">
      {/* sparkle stars (only visible when cheering) */}
      <g className="ellie-stars">
        <path d="M100 18l2.4 5 5.4.8-3.9 3.8.9 5.4-4.8-2.6-4.8 2.6.9-5.4-3.9-3.8 5.4-.8z" fill="#FCD34D" />
        <path d="M14 26l1.6 3.3 3.6.5-2.6 2.5.6 3.6-3.2-1.7-3.2 1.7.6-3.6-2.6-2.5 3.6-.5z" fill="#7DD3FC" />
        <circle cx="108" cy="46" r="2.4" fill="#F9A8D4" />
      </g>
      <g className="ellie-body">
        {/* tail */}
        <path d="M97 84c6 0 8 4 7 8" stroke="#8FB0D6" strokeWidth="3" strokeLinecap="round" fill="none" />
        {/* legs */}
        <rect x="40" y="94" width="13" height="18" rx="6" fill="#9DBCE2" />
        <rect x="58" y="96" width="13" height="16" rx="6" fill="#A9C7E8" />
        <rect x="76" y="96" width="13" height="16" rx="6" fill="#9DBCE2" />
        <rect x="88" y="92" width="11" height="18" rx="5.5" fill="#A9C7E8" />
        <ellipse cx="46.5" cy="111" rx="6" ry="2" fill="#EEF4FB" />
        <ellipse cx="64.5" cy="111" rx="6" ry="2" fill="#EEF4FB" />
        {/* body */}
        <ellipse cx="70" cy="84" rx="32" ry="22" fill="#B4CFEE" />
        <ellipse cx="72" cy="90" rx="20" ry="11" fill="#C9DDF4" />
        {/* ear (behind head) */}
        <g className="ellie-ear">
          <ellipse cx="66" cy="54" rx="19" ry="22" fill="#9DBCE2" />
          <ellipse cx="67" cy="55" rx="12" ry="15" fill="#F7B6C8" />
        </g>
        {/* head */}
        <circle cx="48" cy="56" r="25" fill="#BDD6F2" />
        {/* trunk */}
        <g className="ellie-trunk">
          <path d="M30 62c-10 4-15 16-9 24 4 5 10 2 8-3" stroke="#BDD6F2" strokeWidth="10" strokeLinecap="round" fill="none" />
          <path d="M23 70c1.8 1 3.6 1.4 5.4 1.2M21 77c1.8.6 3.6.6 5.2 0" stroke="#9DBCE2" strokeWidth="1.4" strokeLinecap="round" fill="none" />
        </g>
        {/* cheek, eye, smile */}
        <circle cx="40" cy="64" r="4.5" fill="#F7B6C8" opacity="0.85" />
        <g className="ellie-eye">
          <ellipse cx="46" cy="52" rx="3.6" ry="4.6" fill="#1E293B" />
          <circle cx="47.3" cy="50.4" r="1.3" fill="#fff" />
        </g>
        <path d="M51 64c2.5 2 5.5 2 8 0" stroke="#1E293B" strokeWidth="1.8" strokeLinecap="round" fill="none" />
        {/* graduation cap */}
        <g className="ellie-cap">
          <path d="M30 32l20-9 20 9-20 9z" fill="#1E293B" />
          <path d="M38 36v6c0 2 5.5 4 12 4s12-2 12-4v-6l-12 5z" fill="#334155" />
          <path d="M66 34v9" stroke="#7DD3FC" strokeWidth="1.6" />
          <circle cx="66" cy="44" r="2.2" fill="#7DD3FC" />
        </g>
      </g>
    </svg>
  )
}

// Shared outline icons so every row and header uses the same glyphs, size and stroke.

const base = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  viewBox: '0 0 24 24',
  'aria-hidden': true,
}

export function PencilIcon({ className = 'w-4 h-4' }) {
  return (
    <svg className={className} {...base}>
      <path d="M16.86 4.49l1.69-1.69a1.88 1.88 0 112.65 2.65L10.58 16.07a4.5 4.5 0 01-1.9 1.13L6 18l.8-2.69a4.5 4.5 0 011.13-1.9l8.93-8.92zm0 0L19.5 7.13" />
    </svg>
  )
}

export function TrashIcon({ className = 'w-4 h-4' }) {
  return (
    <svg className={className} {...base}>
      <path d="M14.74 9l-.35 9m-4.78 0L9.26 9m9.97-3.21c.34.05.68.11 1.02.17m-1.02-.17L18.16 19.67a2.25 2.25 0 01-2.24 2.08H8.08a2.25 2.25 0 01-2.24-2.08L4.77 5.79m14.46 0a48.1 48.1 0 00-3.48-.4m-12 .56c.34-.06.68-.11 1.02-.16m0 0a48.1 48.1 0 013.48-.4m7.5 0v-.92c0-1.18-.91-2.16-2.09-2.2a52 52 0 00-3.32 0c-1.18.04-2.09 1.02-2.09 2.2v.92m7.5 0a48.7 48.7 0 00-7.5 0" />
    </svg>
  )
}

export function ChevronDownIcon({ className = 'w-3.5 h-3.5' }) {
  return (
    <svg className={className} {...base} strokeWidth={2}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

export function ChevronRightIcon({ className = 'w-3.5 h-3.5' }) {
  return (
    <svg className={className} {...base} strokeWidth={2}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  )
}

export function GripIcon({ className = 'w-4 h-4' }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24" aria-hidden>
      <circle cx="9" cy="6" r="1.4" /><circle cx="15" cy="6" r="1.4" />
      <circle cx="9" cy="12" r="1.4" /><circle cx="15" cy="12" r="1.4" />
      <circle cx="9" cy="18" r="1.4" /><circle cx="15" cy="18" r="1.4" />
    </svg>
  )
}

// Consistent square icon button (32px hit target, 16px glyph).
export const iconButton =
  'inline-flex items-center justify-center w-8 h-8 shrink-0 rounded-lg text-slate-400 transition-colors'

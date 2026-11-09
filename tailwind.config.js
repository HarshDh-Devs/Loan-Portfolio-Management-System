import defaultColors from 'tailwindcss/colors'
import plugin from 'tailwindcss/plugin'

/*
 * Theme-aware color palette.
 *
 * Every Tailwind color family reads from CSS variables instead of fixed hex:
 *   --c-<family>-<shade>  backgrounds, borders, rings, dividers
 *   --t-<family>-<shade>  text colors (kept separate so dark mode can brighten
 *                         text without washing out solid buttons)
 *
 * :root holds Tailwind's stock values, so light mode is unchanged. Inside
 * `.dashboard-shell--dark` the variables are swapped for a dark palette, so
 * any class (including opacity variants like bg-slate-50/40, hover states and
 * divide-*) adapts automatically. No per-class overrides needed.
 */

const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]
const NEUTRALS = ['slate', 'gray', 'zinc', 'neutral', 'stone']
const CHROMATIC = [
  'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal',
  'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose',
]
const FAMILIES = [...NEUTRALS, ...CHROMATIC]

// Dark surface that tinted chips/badges are blended onto (matches --dash-surface).
const DARK_SURFACE = '#161a21'
const DARK_WHITE = DARK_SURFACE

// Cool, inverted neutral ramp for dark mode (50 = subtle raised surface, 900 = primary text).
const DARK_NEUTRAL_BG = {
  50: '#1a1f27', 100: '#222833', 200: '#2a313c', 300: '#3a424f', 400: '#7a8392',
  500: '#939cab', 600: '#aab2bf', 700: '#c6ccd6', 800: '#dce0e7', 900: '#eceef2', 950: '#f6f7f9',
}
const DARK_NEUTRAL_TEXT = { ...DARK_NEUTRAL_BG, 300: '#545d6b' }

// Chromatic tints (50–300) become the brand hue blended into the dark surface.
const TINT_MIX = { 50: 0.12, 100: 0.18, 200: 0.3, 300: 0.42 }
// Deep shades used as bars/accents get lifted so they stay visible on dark.
const DARK_BG_SHIFT = { 800: 600, 900: 700, 950: 800 }
// Text shades are mirrored toward the light end for contrast on dark surfaces.
const DARK_TEXT_SHIFT = { 500: 400, 600: 400, 700: 300, 800: 200, 900: 100, 950: 50 }

const hexToRgb = (hex) => {
  const h = hex.replace('#', '')
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
}
const triplet = (hex) => hexToRgb(hex).join(' ')
const mix = (fg, bg, amount) => {
  const a = hexToRgb(fg)
  const b = hexToRgb(bg)
  return a.map((v, i) => Math.round(v * amount + b[i] * (1 - amount))).join(' ')
}

const varScale = (prefix, family) =>
  Object.fromEntries(SHADES.map((s) => [s, `rgb(var(--${prefix}-${family}-${s}) / <alpha-value>)`]))

const colorVars = Object.fromEntries(FAMILIES.map((f) => [f, varScale('c', f)]))
const textVars = Object.fromEntries(FAMILIES.map((f) => [f, varScale('t', f)]))

const themePalette = plugin(({ addBase }) => {
  const light = { '--c-white': '255 255 255' }
  const dark = { '--c-white': triplet(DARK_WHITE) }

  for (const f of FAMILIES) {
    const base = defaultColors[f]
    for (const s of SHADES) {
      light[`--c-${f}-${s}`] = triplet(base[s])
      light[`--t-${f}-${s}`] = triplet(base[s])

      if (NEUTRALS.includes(f)) {
        dark[`--c-${f}-${s}`] = triplet(DARK_NEUTRAL_BG[s])
        dark[`--t-${f}-${s}`] = triplet(DARK_NEUTRAL_TEXT[s])
      } else {
        dark[`--c-${f}-${s}`] = TINT_MIX[s]
          ? mix(base[500], DARK_SURFACE, TINT_MIX[s])
          : triplet(base[DARK_BG_SHIFT[s] ?? s])
        dark[`--t-${f}-${s}`] = triplet(base[DARK_TEXT_SHIFT[s] ?? s])
      }
    }
  }

  addBase({ ':root': light, '.dashboard-shell--dark': dark })
})

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ...colorVars,
        white: 'rgb(var(--c-white) / <alpha-value>)',
      },
      textColor: {
        ...textVars,
        white: '#ffffff',
      },
    },
  },
  plugins: [themePalette],
}

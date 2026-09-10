/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        luxury: {
          950: '#0A0B0D',
          900: '#111317',
          850: '#16191F',
          800: '#1C2028',
          750: '#232832',
          700: '#2B313D',
          600: '#3D4555',
          500: '#5A6478',
          400: '#8590A5',
          300: '#B2BCCD',
          200: '#D5DCE8',
          100: '#F0F3F8',
          50: '#F8FAFC',
        },
        gold: {
          900: '#5E4A1E',
          800: '#8A6D2C',
          700: '#B38E3A',
          600: '#C5A880',
          500: '#D4AF37',
          400: '#E6C86E',
          300: '#F3DD9C',
          200: '#F9ECC8',
          100: '#FCF7E9',
        },
        charcoal: {
          950: '#090A0C',
          900: '#0E1013',
          800: '#15181D',
          700: '#1E2229',
          600: '#2A303A',
        },
        /**
         * MUREEH PLATFORM BLUE — the SaaS/console brand ramp.
         *
         * Design-QA finding DS-001: these values were hardcoded as raw hex
         * literals ~345 times across the app (#0072BC alone appeared 106
         * times) while the Tailwind theme only defined gold/luxury. That made
         * the primary brand colour impossible to retheme and invited
         * near-duplicate shades to creep in.
         *
         * Tokenised here with the EXACT existing values, so adopting
         * `bg-brand-500` in place of `bg-[#0072BC]` is a pure refactor with
         * zero visual change. Numbering follows luminance, matching the
         * `luxury`/`gold` ramps above.
         *
         * NOTE: `brand-*` is the platform identity. It is deliberately
         * distinct from the per-tenant `--brand-primary` CSS variables in
         * index.css, which restyle the CUSTOMER menu per restaurant.
         */
        brand: {
          950: '#020A14', // page background (deepest)
          900: '#031326',
          880: '#040D1A', // app shell background
          860: '#04121F',
          850: '#071B2E',
          800: '#081B33', // raised surface / card
          750: '#0B2545',
          700: '#0B3C63',
          600: '#003865', // gradient start
          500: '#004B87', // borders / gradient mid
          400: '#0072BC', // PRIMARY action
          300: '#009FE3', // gradient end
          200: '#38BDF8', // accent text / icons
          150: '#7DD3FC',
          100: '#E0F2FE', // lightest text on blue
        },
      },
      fontFamily: {
        sans: ['Tajawal', 'Cairo', 'system-ui', '-apple-system', 'sans-serif'],
        serif: ['Cormorant Garamond', 'serif'],
        arabic: ['Tajawal', 'Cairo', 'sans-serif'],
      },
      boxShadow: {
        'luxury': '0 10px 30px -10px rgba(0, 0, 0, 0.7)',
        'gold-glow': '0 0 20px -5px rgba(212, 175, 55, 0.25)',
        'inner-glow': 'inset 0 1px 1px 0 rgba(255, 255, 255, 0.05)',
      },
      // Overlays across the app are authored as `z-60` (e.g. the customer's
      // order-completed modal) to sit above the `z-50` drawers/notifiers and
      // below the `z-[70]`–`z-[100]` full screens. Tailwind's default scale
      // stops at 50, so `z-60` used to generate no CSS and those overlays
      // painted UNDER the z-50 layer they were meant to cover.
      zIndex: {
        '60': '60',
      }
    },
  },
  plugins: [],
}

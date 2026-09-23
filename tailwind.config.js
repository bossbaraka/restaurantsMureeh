/** @type {import('tailwindcss').Config} */
import tailwindcssAnimate from 'tailwindcss-animate';

export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      /**
       * `xs` — the narrow-phone breakpoint.
       *
       * Components already authored `hidden xs:inline` / `xs:flex` to drop
       * secondary labels on small phones (MenuToolbar's "المتوفر فقط",
       * CustomerHeader's English name, the welcome screen's table chip), but
       * `xs` was never defined — so Tailwind emitted NO rule for those
       * variants and the elements stayed `hidden` at EVERY width.
       *
       * Measured consequence in MenuToolbar: with the label permanently
       * hidden the controls fit, but the authored progressive-disclosure
       * behaviour never happened. Defining the breakpoint activates the
       * intent that is already in the markup, at the width where the toolbar
       * measurably has room for it.
       */
      screens: {
        xs: '400px',
      },
      colors: {
        /**
         * CUSTOMER SEMANTIC COLOURS.
         *
         * Backed by the `--m-*-rgb` channel tokens the CustomerThemeProvider
         * writes onto the customer scope, in the `<alpha-value>` form Tailwind
         * substitutes. This is what allows an opacity-modified customer class
         * (`bg-m-surface/80`) to keep its transparency while sourcing its
         * colour from the tenant theme — previously only the fixed `luxury-*`
         * ramp could do that, which is precisely why the customer UI was
         * locked to a dark palette.
         *
         * These are CUSTOMER tokens. Platform/admin surfaces keep using
         * `luxury-*`/`gold-*`, which remain untouched.
         */
        m: {
          bg: 'rgb(var(--m-bg-rgb) / <alpha-value>)',
          surface: 'rgb(var(--m-surface-rgb) / <alpha-value>)',
          'surface-raised': 'rgb(var(--m-surface-raised-rgb) / <alpha-value>)',
          text: 'rgb(var(--m-text-rgb) / <alpha-value>)',
          'text-muted': 'rgb(var(--m-text-muted-rgb) / <alpha-value>)',
          'text-subtle': 'rgb(var(--m-text-subtle-rgb) / <alpha-value>)',
          hairline: 'rgb(var(--m-hairline-rgb) / <alpha-value>)',
          brand: 'rgb(var(--m-brand-rgb) / <alpha-value>)',
          'brand-accent': 'rgb(var(--m-brand-accent-rgb) / <alpha-value>)',
          'brand-strong': 'rgb(var(--m-brand-on-surface-rgb) / <alpha-value>)',
          /**
           * STATUS — the canonical `--m-success/-warning/-error` tokens
           * (platform-fixed, not manager-editable) and their channel triplets.
           * Values are IDENTICAL to the Tailwind emerald-500 / amber-500 /
           * red-500 shades the customer UI was painting status with by hand,
           * so adopting these is zero-visual-change — it just gives status
           * colouring ONE owner instead of raw palette classes.
           */
          success: 'rgb(var(--m-success-rgb) / <alpha-value>)',
          warning: 'rgb(var(--m-warning-rgb) / <alpha-value>)',
          error: 'rgb(var(--m-error-rgb) / <alpha-value>)',
        },
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
        /**
         * `font-serif` is applied to ARABIC headings across the customer menu
         * (35 usages), but Cormorant Garamond has no Arabic glyphs — Arabic
         * fell through to the device's generic serif, while the entry loader
         * renders the same restaurant name in Amiri. Amiri (already loaded by
         * index.html, and first in the --font-serif token) is inserted as the
         * Arabic fallback so one serif identity serves both scripts. Latin
         * still renders Cormorant Garamond — zero change for English text.
         */
        serif: ['Cormorant Garamond', 'Amiri', 'Georgia', 'serif'],
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
        // Step-up re-verification overlay — above the z-60 app overlays,
        // below the z-[100] full screens.
        '70': '70',
      }
    },
  },
  /**
   * tailwindcss-animate — owns the `animate-in` / `fade-in` / `slide-in-from-*`
   * / `zoom-in-*` entrance vocabulary that customer overlays were ALREADY
   * authored with (34 usages across drawers, sheets, modals and floating
   * bars). Without this plugin those classes generated NO CSS, so every
   * customer overlay appeared in one hard frame with no entrance animation.
   * Registering the plugin activates the intent already in the markup;
   * the global `prefers-reduced-motion` guard (index.css) applies to the
   * generated keyframes automatically.
   */
  plugins: [tailwindcssAnimate],
}

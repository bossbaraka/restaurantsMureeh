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
        }
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
      }
    },
  },
  plugins: [],
}

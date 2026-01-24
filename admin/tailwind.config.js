/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}'
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Dark fantasy theme inspired by Modia's parchment aesthetic
        parchment: {
          50: '#faf8f5',
          100: '#f5f0e8',
          200: '#e8dcc8',
          300: '#d9c5a3',
          400: '#c9a87a',
          500: '#b8895a',
          600: '#a67349',
          700: '#8a5d3b',
          800: '#714c33',
          900: '#5c3f2c'
        },
        midnight: {
          50: '#f5f5f7',
          100: '#e5e5ea',
          200: '#c7c7d0',
          300: '#9e9eab',
          400: '#76768a',
          500: '#5c5c72',
          600: '#4a4a5e',
          700: '#3d3d4f',
          800: '#2d2d3d',
          900: '#1a1a2e',
          950: '#0f0f1a'
        },
        accent: {
          gold: '#d4a44a',
          copper: '#b87333',
          emerald: '#2e8b57',
          ruby: '#9b111e',
          sapphire: '#0f52ba'
        }
      },
      fontFamily: {
        display: ['Georgia', 'Cambria', 'Times New Roman', 'serif'],
        body: ['system-ui', '-apple-system', 'sans-serif']
      },
      boxShadow: {
        'glow-gold': '0 0 15px rgba(212, 164, 74, 0.3)',
        'glow-emerald': '0 0 15px rgba(46, 139, 87, 0.3)'
      }
    }
  },
  plugins: []
};

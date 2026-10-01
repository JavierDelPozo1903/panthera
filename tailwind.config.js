/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'system-ui', 'sans-serif'],
        serif: ['"Cormorant Garamond"', 'Georgia', 'serif'],
      },
      colors: {
        // Paleta tierra de documental de naturaleza
        bone: '#f3ead7',
        sand: '#e3cfa4',
        ochre: '#c9953c',
        clay: '#a5602f',
        earth: '#4a3423',
        umber: '#2a1d14',
        night: '#15100b',
        acacia: '#6f7d3c',
      },
      letterSpacing: {
        title: '0.42em',
      },
      keyframes: {
        fadeIn: { from: { opacity: '0' }, to: { opacity: '1' } },
        riseIn: {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        fadeIn: 'fadeIn 0.8s ease-out both',
        riseIn: 'riseIn 0.9s ease-out both',
      },
    },
  },
  plugins: [],
};

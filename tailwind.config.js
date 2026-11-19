/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          900: '#121218',
          850: '#17171f',
          800: '#1c1c26',
          700: '#252532',
          600: '#32323f'
        },
        accent: {
          DEFAULT: '#e5484d',
          soft: '#ff6369'
        }
      },
      boxShadow: {
        glass: '0 8px 32px rgba(0,0,0,0.35)',
        soft: '0 4px 20px rgba(0,0,0,0.25)'
      },
      backdropBlur: { xs: '2px' }
    }
  },
  plugins: []
}

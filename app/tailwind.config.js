/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        base: '#121212',
        card: '#1E1E1E',
        line: '#2E2E2E',
        fg: '#F2F2F2',
        sub: '#A0A0A0',
        accent: '#4DA3FF',
        done: '#3DDC97',
        late: '#F5B841',
      },
      fontFamily: {
        sans: ['"Noto Sans JP"', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        note: ['16px', { lineHeight: '1.7' }],
        body: ['18px', { lineHeight: '1.7' }],
        title: ['24px', { lineHeight: '1.45' }],
        task: ['28px', { lineHeight: '1.4' }],
        hero: ['32px', { lineHeight: '1.35' }],
      },
      maxWidth: { app: '480px' },
      minHeight: { tap: '56px' },
      height: { tap: '56px' },
    },
  },
  plugins: [],
}

import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Tokens do design system "Cobra pra mim" (Claude Design):
        // azul #3545BC, verde #8CC74F, creme #E5EADF, escuro #243837.
        primary: {
          50: '#edeffb',
          100: '#d6dbf5',
          200: '#adb7eb',
          300: '#8090e0',
          400: '#5a67cb',
          500: '#3545bc',
          600: '#2b37a0',
          700: '#222b7e',
          800: '#1a2160',
          900: '#141947'
        },
        // Verde da cobra — sucesso e acento.
        leaf: {
          50: '#f1f8e7',
          100: '#e1f0cb',
          200: '#c5e39d',
          300: '#a8d66f',
          400: '#98cf5c',
          500: '#8cc74f',
          600: '#71a93d',
          700: '#588431',
          800: '#446527',
          900: '#334d1e'
        },
        // Neutros ancorados no creme e no verde-escuro da marca.
        sand: {
          50: '#f6f7f2',
          100: '#e5eadf',
          200: '#cdd4c4',
          300: '#afb9a4',
          400: '#8b9884',
          500: '#687563',
          600: '#4c5a4d',
          700: '#384540',
          800: '#2c3934',
          900: '#243837',
          950: '#16211f'
        },
        // Laranja — atenção / pendências.
        flame: {
          50: '#ffede3',
          100: '#ffd4bd',
          200: '#ffad82',
          300: '#ff8749',
          400: '#ff7429',
          500: '#ff6400',
          600: '#d65500',
          700: '#a84300',
          800: '#7a3100',
          900: '#522100'
        },
        // Vermelho — inadimplência / ações destrutivas.
        danger: {
          50: '#fdecec',
          100: '#fad0cf',
          500: '#d64545',
          600: '#b5342f',
          700: '#8f2724'
        },
        // Verde quase-preto pedido pela marca para superfícies escuras.
        ink: '#15261c'
      },
      fontFamily: {
        sans: ['var(--font-jakarta)', 'Google Sans', 'system-ui', 'sans-serif']
      },
      boxShadow: {
        card: '0 1px 2px rgba(36, 56, 55, 0.08)',
        pop: '0 4px 12px rgba(36, 56, 55, 0.10)',
        float: '0 12px 32px rgba(36, 56, 55, 0.14)',
        focus: '0 0 0 3px #c5e39d'
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' }
        },
        'pop-in': {
          from: { opacity: '0', transform: 'scale(.96) translateY(6px)' },
          to: { opacity: '1', transform: 'scale(1) translateY(0)' }
        },
        'toast-in': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' }
        }
      },
      animation: {
        'fade-in': 'fade-in .15s cubic-bezier(0.4, 0, 0.2, 1)',
        'pop-in': 'pop-in .18s cubic-bezier(0.4, 0, 0.2, 1)',
        'toast-in': 'toast-in .2s cubic-bezier(0.4, 0, 0.2, 1)'
      }
    }
  },
  plugins: []
};

export default config;

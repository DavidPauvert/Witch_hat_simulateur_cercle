/** @type {import('tailwindcss').Config} */
export default {
    content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
    theme: {
        extend: {
            colors: {
                ink: '#241b16',
                mutedink: '#6d594b',
                paper: '#f4dc95',
                paperdeep: '#d9aa54',
                panel: '#fff7db',
                panelline: '#c59b55',
                ember: '#b84531',
                teal: '#2a7987',
                violet: '#5d507f',
                gold: '#c8960c',
                whabg: '#3f3930',
                shadowink: 'rgba(36, 27, 22, 0.22)',
            },
            fontFamily: {
                serif: ["'IM Fell English'", 'Georgia', 'serif'],
                display: ["'Cinzel'", 'serif'],
                mono: [
                    "'JetBrains Mono'",
                    'Consolas',
                    "'Courier New'",
                    'monospace',
                ],
            },
            boxShadow: {
                'wha-panel': '0 18px 45px rgba(36, 27, 22, 0.22)',
            },
            borderRadius: {
                wha: '8px',
            },
            transitionDuration: {
                140: '140ms',
                160: '160ms',
                980: '980ms',
            },
        },
    },
    plugins: [],
};

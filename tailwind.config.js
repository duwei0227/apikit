/** @type {import('tailwindcss').Config} */
import PrimeUI from 'tailwindcss-primeui';

export default {
    content: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
    darkMode: ['selector', '[class="p-dark"]'],
    theme: {
        extend: {
            fontSize: {
                badge: ['10px', '14px'],
                meta: ['11px', '16px'],
                xs: ['12px', '16px'],
                sm: ['13px', '18px'],
                base: ['14px', '20px'],
                lg: ['16px', '22px']
            }
        }
    },
    plugins: [PrimeUI]
};

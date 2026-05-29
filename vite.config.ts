import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    base: './',
    build: {
        emptyOutDir: true,
        minify: 'esbuild',
        outDir: 'dist',
        rollupOptions: {
            input: {
                main: 'index.html',
            },
        },
        sourcemap: false,
    },
});

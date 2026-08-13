import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative asset paths so the same build loads over http AND file://
  // (the Electron desktop shell loads the built Studio from disk).
  base: './',
  server: { port: 5183, strictPort: true },
  build: { target: 'es2022', sourcemap: true },
});
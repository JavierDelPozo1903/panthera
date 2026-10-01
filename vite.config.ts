import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Polling: los eventos de sistema de ficheros no son fiables en carpetas sincronizadas (OneDrive).
  server: { port: 5173, strictPort: false, watch: { usePolling: true, interval: 250 } },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    // Rapier (compat) incrusta su WASM en el chunk de física (~2 MB, ~770 kB gzip).
    chunkSizeWarningLimit: 2200,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          r3f: ['@react-three/fiber', '@react-three/drei', '@react-three/postprocessing'],
          physics: ['@react-three/rapier'],
        },
      },
    },
  },
});

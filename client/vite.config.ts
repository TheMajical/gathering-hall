import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/socket.io': { target: 'http://localhost:8080', ws: true },
      '/healthz': { target: 'http://localhost:8080' },
    },
  },
  build: { outDir: 'dist' },
});

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Dev convenience: `npm run dev` proxies /api to the FastAPI backend so a
    // plain relative VITE_API_URL works in both dev and the built app.
    proxy: {
      '/api': 'http://localhost:8020',
    },
  },
});

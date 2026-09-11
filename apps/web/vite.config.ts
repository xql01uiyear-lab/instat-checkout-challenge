import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The API allows any localhost origin via CORS, so the browser talks to it directly.
// Override the base URL with VITE_API_URL when the API runs on a non-default port.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
});

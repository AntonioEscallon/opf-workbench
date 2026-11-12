import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Static site: everything runs in the browser (mock data, stub solver), so it can be hosted on GitHub Pages.
// BASE_PATH is set by the Pages workflow to /<repo>/; local dev serves from /.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
  server: { port: 5174 },
  test: { globals: true, environment: 'node' },
} as any)

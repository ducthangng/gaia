import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Chạy cùng backend ở máy: VITE_API_URL=/api trong .env.local, API ở cổng 3000.
  server: { proxy: { '/api': process.env.API_PROXY ?? 'http://localhost:3000' } },
  test: { include: ['src/**/*.test.ts'] },
})

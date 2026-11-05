import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  // Chạy cùng backend ở máy: VITE_API_URL=/api trong .env.local, API ở cổng 3000 (đổi bằng API_PROXY).
  server: { proxy: { '/api': loadEnv(mode, '.', '').API_PROXY || 'http://localhost:3000' } },
  test: { include: ['src/**/*.test.ts'] },
}))

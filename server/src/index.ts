import { serve } from '@hono/node-server'
import { createApp } from './app'
import { createUser } from './auth'
import { createPool, migrate } from './db'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('Thiếu DATABASE_URL')
  process.exit(1)
}

const db = createPool(url)
await migrate(db)

// Lần chạy đầu trên Railway: tạo admin từ biến môi trường nếu chưa có ai. Tạo xong nên xoá ADMIN_PASSWORD.
const { rows } = await db.query('select count(*)::int as n from users')
if (rows[0].n === 0 && process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
  await createUser(db, process.env.ADMIN_EMAIL, process.env.ADMIN_NAME ?? 'Admin', process.env.ADMIN_PASSWORD, 'admin')
  console.log(`Đã tạo admin ${process.env.ADMIN_EMAIL}`)
}

const app = createApp(db, {
  secureCookie: process.env.NODE_ENV === 'production',
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
})

const port = Number(process.env.PORT ?? 3000)
const server = serve({ fetch: app.fetch, port, hostname: '::' }, () => console.log(`Gaia API: http://localhost:${port}/api`))

const stop = () => {
  server.close()
  db.end().finally(() => process.exit(0))
}
process.on('SIGTERM', stop)
process.on('SIGINT', stop)

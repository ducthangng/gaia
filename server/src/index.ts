import { serve } from '@hono/node-server'
import { createApp } from './app'
import { createUser } from './auth'
import { createPool, migrate } from './db'

// Cổng bắt buộc lấy từ biến PORT (Railway tự cấp; domain trong Settings → Networking phải trỏ đúng cổng này).
// Không có giá trị mặc định: thiếu hoặc sai thì dừng ngay với thông báo rõ, thay vì chạy nhầm cổng rồi bị 502.
const rawPort = process.env.PORT?.trim()
const port = Number(rawPort)
if (!rawPort || !Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(rawPort ? `PORT không hợp lệ: "${rawPort}"` : 'Thiếu biến PORT')
  process.exit(1)
}

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
  // Lỗi ở đây (ví dụ mật khẩu quá ngắn) không được làm server dừng: vẫn chạy để còn đọc được log và health check.
  try {
    await createUser(db, process.env.ADMIN_EMAIL, process.env.ADMIN_NAME ?? 'Admin', process.env.ADMIN_PASSWORD, 'admin')
    console.log(`Đã tạo admin ${process.env.ADMIN_EMAIL}`)
  } catch (e) {
    console.error(`Không tạo được admin từ ADMIN_EMAIL/ADMIN_PASSWORD: ${e instanceof Error ? e.message : e}`)
  }
}

const app = createApp(db, {
  secureCookie: process.env.NODE_ENV === 'production',
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
})

const server = serve({ fetch: app.fetch, port, hostname: '::' }, () => console.log(`Gaia API đang nghe cổng ${port} (từ biến PORT): http://localhost:${port}/api`))
server.on('error', (e) => {
  console.error(`Không mở được cổng ${port}: ${e.message}`)
  process.exit(1)
})

const stop = () => {
  server.close()
  db.end().finally(() => process.exit(0))
}
process.on('SIGTERM', stop)
process.on('SIGINT', stop)

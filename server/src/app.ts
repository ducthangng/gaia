import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { compress } from 'hono/compress'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { cors } from 'hono/cors'
import { HTTPException } from 'hono/http-exception'
import { addUser, listUsers, login, logout, LoginLimiter, SESSION_DAYS, updateUser, UserInputError, userForToken, type User } from './auth'
import type { Db } from './db'
import { entityHistory, history, push, read, validate, type Entity } from './store'
import { addTodo, deleteTodo, listTodos, updateTodo } from './todos'

export interface AppOptions {
  /** Cookie Secure: bật ở môi trường thật (HTTPS). */
  secureCookie: boolean
  /** Origin được gọi thẳng API (khi frontend không đi qua proxy cùng domain). Rỗng = chỉ cùng origin. */
  allowedOrigins: string[]
}

const COOKIE = 'gaia_session'

type Env = { Variables: { user: User; token: string } }

export function createApp(db: Db, opts: AppOptions) {
  const app = new Hono<Env>().basePath('/api')
  const limiter = new LoginLimiter()

  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status)
    if (err instanceof UserInputError) return c.json({ error: err.message }, 400)
    console.error(err)
    return c.json({ error: 'Lỗi máy chủ' }, 500)
  })

  if (opts.allowedOrigins.length) app.use(cors({ origin: opts.allowedOrigins, credentials: true }))
  app.use(compress())
  app.use(bodyLimit({ maxSize: 25 * 1024 * 1024, onError: (c) => c.json({ error: 'Dữ liệu gửi lên quá lớn' }, 413) }))

  // Chống CSRF: mọi request ghi phải là JSON (form của trang lạ không gửi được JSON mà không qua preflight CORS).
  app.use(async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && c.req.method !== 'OPTIONS' && !c.req.header('content-type')?.startsWith('application/json')) {
      return c.json({ error: 'Cần Content-Type: application/json' }, 415)
    }
    await next()
  })

  app.get('/health', async (c) => {
    await db.query('select 1')
    return c.json({ ok: true })
  })

  app.post('/auth/login', async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const email = typeof body.email === 'string' ? body.email : ''
    const password = typeof body.password === 'string' ? body.password : ''
    const key = `${clientIp(c)}|${email.toLowerCase()}`
    if (limiter.blocked(key)) return c.json({ error: 'Sai quá nhiều lần. Thử lại sau 15 phút.' }, 429)
    const res = email && password ? await login(db, email, password) : null
    if (!res) {
      limiter.fail(key)
      return c.json({ error: 'Email hoặc mật khẩu không đúng' }, 401)
    }
    limiter.reset(key)
    setCookie(c, COOKIE, res.token, { httpOnly: true, secure: opts.secureCookie, sameSite: 'Lax', path: '/', maxAge: SESSION_DAYS * 86400 })
    return c.json({ user: res.user })
  })

  app.post('/auth/logout', async (c) => {
    const token = getCookie(c, COOKIE)
    if (token) await logout(db, token)
    deleteCookie(c, COOKIE, { path: '/' })
    return c.json({ ok: true })
  })

  // Từ đây trở xuống cần đăng nhập.
  app.use(async (c, next) => {
    const token = getCookie(c, COOKIE)
    const user = token ? await userForToken(db, token) : null
    if (!user) return c.json({ error: 'Chưa đăng nhập' }, 401)
    c.set('user', user)
    c.set('token', token!)
    await next()
  })

  app.get('/auth/me', (c) => c.json({ user: c.get('user') }))

  /** Toàn bộ dữ liệu, hoặc ?since=rev để lấy phần thay đổi. */
  app.get('/state', async (c) => {
    const since = c.req.query('since')
    if (since !== undefined && !/^\d+$/.test(since)) return c.json({ error: 'since không hợp lệ' }, 400)
    c.header('Cache-Control', 'no-store')
    return c.json(await read(db, since === undefined ? undefined : Number(since)))
  })

  app.post('/changes', async (c) => {
    const body = await c.req.json().catch(() => null)
    if (!body || typeof body.baseRev !== 'number' || body.baseRev < 0) return c.json({ error: 'Thiếu baseRev' }, 400)
    const error = validate(body.changes)
    if (error) return c.json({ error }, 400)
    const summary = typeof body.summary === 'string' ? body.summary : null
    const res = await push(db, c.get('user').id, body.baseRev, body.changes as Entity[], summary)
    return res.ok ? c.json(res) : c.json(res, 409)
  })

  app.get('/history', async (c) => {
    const limit = Math.min(Number(c.req.query('limit') ?? 50) || 50, 500)
    const collection = c.req.query('c')
    const id = c.req.query('id')
    if (collection && id) return c.json({ items: await entityHistory(db, collection, id) })
    return c.json({ items: await history(db, limit) })
  })

  // Quản lý tài khoản: chỉ admin.
  const adminOnly = async (c: Context<Env>, next: () => Promise<void>) => {
    if (c.get('user').role !== 'admin') return c.json({ error: 'Chỉ admin được quản lý tài khoản' }, 403)
    await next()
  }
  const body = async (c: Context) => {
    const b = await c.req.json().catch(() => null)
    return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : {}
  }
  app.get('/users', adminOnly, async (c) => c.json({ users: await listUsers(db) }))
  app.post('/users', adminOnly, async (c) => c.json({ user: await addUser(db, await body(c)) }, 201))
  app.post('/users/:id', adminOnly, async (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id)) return c.json({ error: 'id không hợp lệ' }, 400)
    return c.json({ user: await updateUser(db, c.get('user').id, id, await body(c)) })
  })

  // Việc cần làm / góp ý về app: ai cũng thêm được, admin đánh dấu xong.
  const todoId = (c: Context) => {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id)) throw new UserInputError('id không hợp lệ')
    return id
  }
  app.get('/todos', async (c) => c.json({ todos: await listTodos(db) }))
  app.post('/todos', async (c) => c.json({ todo: await addTodo(db, c.get('user'), await body(c)) }, 201))
  app.post('/todos/:id', async (c) => c.json({ todo: await updateTodo(db, c.get('user'), todoId(c), await body(c)) }))
  app.post('/todos/:id/delete', async (c) => {
    await deleteTodo(db, c.get('user'), todoId(c))
    return c.json({ ok: true })
  })

  return app
}

const clientIp = (c: Context) => c.req.header('x-forwarded-for')?.split(',')[0].trim() ?? c.req.header('x-real-ip') ?? 'local'

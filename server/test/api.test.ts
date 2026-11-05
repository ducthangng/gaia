import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { createUser } from '../src/auth'
import { createPool, migrate, type Db } from '../src/db'

let pglite: PGlite
let socket: PGLiteSocketServer
let db: Db
let app: ReturnType<typeof createApp>

beforeAll(async () => {
  pglite = await PGlite.create()
  socket = new PGLiteSocketServer({ db: pglite, port: 54329, host: '127.0.0.1' })
  await socket.start()
  // PGlite chỉ có một kết nối: pool 1 để các transaction không đan nhau.
  db = createPool('postgres://postgres@127.0.0.1:54329/postgres')
  db.options.max = 1
  await migrate(db)
  await createUser(db, 'a@gaia.vn', 'An', 'mat-khau-dai-1', 'admin')
  await createUser(db, 'b@gaia.vn', 'Bình', 'mat-khau-dai-2', 'editor')
  app = createApp(db, { secureCookie: false, allowedOrigins: [] })
})

afterAll(async () => {
  await db?.end()
  await socket?.stop()
  await pglite?.close()
})

const json = (body: unknown, cookie?: string) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
  body: JSON.stringify(body),
})

async function signIn(email: string, password: string) {
  const res = await app.request('/api/auth/login', json({ email, password }))
  expect(res.status).toBe(200)
  return res.headers.get('set-cookie')!.split(';')[0]
}

const teacher = (id: string, name: string) => ({ id, name, active: true })

describe('auth', () => {
  it('từ chối khi chưa đăng nhập hoặc sai mật khẩu', async () => {
    expect((await app.request('/api/state')).status).toBe(401)
    expect((await app.request('/api/auth/login', json({ email: 'a@gaia.vn', password: 'sai' }))).status).toBe(401)
    expect((await app.request('/api/auth/login', json({ email: 'khong-co@gaia.vn', password: 'sai' }))).status).toBe(401)
  })

  it('đăng nhập, xem me, đăng xuất thì phiên hết hiệu lực', async () => {
    const cookie = await signIn('A@Gaia.vn', 'mat-khau-dai-1')
    const me = await (await app.request('/api/auth/me', { headers: { cookie } })).json()
    expect(me.user).toMatchObject({ email: 'a@gaia.vn', role: 'admin' })
    await app.request('/api/auth/logout', json({}, cookie))
    expect((await app.request('/api/auth/me', { headers: { cookie } })).status).toBe(401)
  })

  it('chặn request ghi không phải JSON (CSRF)', async () => {
    const cookie = await signIn('a@gaia.vn', 'mat-khau-dai-1')
    const res = await app.request('/api/changes', { method: 'POST', headers: { cookie, 'content-type': 'text/plain' }, body: '{}' })
    expect(res.status).toBe(415)
  })
})

describe('quản lý tài khoản', () => {
  const users = async (cookie: string) => (await (await app.request('/api/users', { headers: { cookie } })).json()).users as { id: number; email: string; disabled: boolean; role: string }[]

  it('chỉ admin xem và tạo được tài khoản', async () => {
    const b = await signIn('b@gaia.vn', 'mat-khau-dai-2')
    expect((await app.request('/api/users', { headers: { cookie: b } })).status).toBe(403)
    expect((await app.request('/api/users', json({ email: 'x@gaia.vn', name: 'X', password: 'mat-khau-dai-x' }, b))).status).toBe(403)
  })

  it('admin tạo tài khoản; email trùng hoặc mật khẩu ngắn bị từ chối', async () => {
    const a = await signIn('a@gaia.vn', 'mat-khau-dai-1')
    const res = await app.request('/api/users', json({ email: ' Moi@Gaia.vn ', name: 'Mới', password: 'mat-khau-moi-1' }, a))
    expect(res.status).toBe(201)
    expect((await res.json()).user).toMatchObject({ email: 'moi@gaia.vn', role: 'editor', disabled: false })
    const dup = await app.request('/api/users', json({ email: 'moi@gaia.vn', name: 'Trùng', password: 'mat-khau-khac-1' }, a))
    expect(dup.status).toBe(400)
    expect((await dup.json()).error).toContain('Đã có')
    expect((await app.request('/api/users', json({ email: 'ngan@gaia.vn', name: 'N', password: 'ngan' }, a))).status).toBe(400)
    // Mật khẩu cũ không bị đặt lại do tạo trùng.
    await signIn('moi@gaia.vn', 'mat-khau-moi-1')
  })

  it('khoá thì đăng xuất ngay; đặt lại mật khẩu thì mật khẩu cũ hết dùng', async () => {
    const a = await signIn('a@gaia.vn', 'mat-khau-dai-1')
    const moi = (await users(a)).find((u) => u.email === 'moi@gaia.vn')!
    const session = await signIn('moi@gaia.vn', 'mat-khau-moi-1')
    expect((await app.request(`/api/users/${moi.id}`, json({ disabled: true }, a))).status).toBe(200)
    expect((await app.request('/api/auth/me', { headers: { cookie: session } })).status).toBe(401)
    expect((await app.request('/api/auth/login', json({ email: 'moi@gaia.vn', password: 'mat-khau-moi-1' }))).status).toBe(401)
    await app.request(`/api/users/${moi.id}`, json({ disabled: false, password: 'mat-khau-moi-2' }, a))
    expect((await app.request('/api/auth/login', json({ email: 'moi@gaia.vn', password: 'mat-khau-moi-1' }))).status).toBe(401)
    await signIn('moi@gaia.vn', 'mat-khau-moi-2')
  })

  it('admin không tự khoá hay tự bỏ quyền admin được', async () => {
    const a = await signIn('a@gaia.vn', 'mat-khau-dai-1')
    const me = (await users(a)).find((u) => u.email === 'a@gaia.vn')!
    expect((await app.request(`/api/users/${me.id}`, json({ disabled: true }, a))).status).toBe(400)
    expect((await app.request(`/api/users/${me.id}`, json({ role: 'editor' }, a))).status).toBe(400)
    expect((await users(a)).find((u) => u.id === me.id)).toMatchObject({ role: 'admin', disabled: false })
  })
})

describe('đồng bộ', () => {
  it('ghi, đọc lại, đọc phần thay đổi theo rev', async () => {
    const cookie = await signIn('a@gaia.vn', 'mat-khau-dai-1')
    const start = await (await app.request('/api/state', { headers: { cookie } })).json()
    const r1 = await (await app.request('/api/changes', json({ baseRev: start.rev, changes: [{ c: 'teacher', id: 'VT1', data: teacher('VT1', 'An') }, { c: 'distance', id: 'home|VT1|s1', data: 12.5 }] }, cookie))).json()
    expect(r1).toMatchObject({ ok: true, applied: 2 })
    const r2 = await (await app.request('/api/changes', json({ baseRev: r1.rev, changes: [{ c: 'distance', id: 'home|VT1|s1', data: null }] }, cookie))).json()
    const full = await (await app.request('/api/state', { headers: { cookie } })).json()
    expect(full.entities).toEqual([{ c: 'teacher', id: 'VT1', data: teacher('VT1', 'An') }])
    const delta = await (await app.request(`/api/state?since=${r1.rev}`, { headers: { cookie } })).json()
    expect(delta).toEqual({ rev: r2.rev, entities: [{ c: 'distance', id: 'home|VT1|s1', data: null }] })
  })

  it('gửi lại đúng giá trị đang có thì không tạo commit', async () => {
    const cookie = await signIn('a@gaia.vn', 'mat-khau-dai-1')
    const { rev } = await (await app.request('/api/state', { headers: { cookie } })).json()
    const res = await (await app.request('/api/changes', json({ baseRev: rev, changes: [{ c: 'teacher', id: 'VT1', data: teacher('VT1', 'An') }] }, cookie))).json()
    expect(res).toEqual({ ok: true, rev, applied: 0 })
  })

  it('hai người sửa cùng bản ghi: người sau bị từ chối và nhận bản mới', async () => {
    const a = await signIn('a@gaia.vn', 'mat-khau-dai-1')
    const b = await signIn('b@gaia.vn', 'mat-khau-dai-2')
    const { rev } = await (await app.request('/api/state', { headers: { cookie: a } })).json()
    const okA = await app.request('/api/changes', json({ baseRev: rev, changes: [{ c: 'teacher', id: 'VT1', data: teacher('VT1', 'An sửa') }] }, a))
    expect(okA.status).toBe(200)
    const resB = await app.request('/api/changes', json({ baseRev: rev, changes: [{ c: 'teacher', id: 'VT1', data: teacher('VT1', 'Bình sửa') }, { c: 'teacher', id: 'VT2', data: teacher('VT2', 'Mới') }] }, b))
    expect(resB.status).toBe(409)
    const body = await resB.json()
    expect(body.conflicts).toEqual([{ c: 'teacher', id: 'VT1', data: teacher('VT1', 'An sửa') }])
    // Cả nhóm bị từ chối: VT2 chưa được ghi.
    const full = await (await app.request('/api/state', { headers: { cookie: b } })).json()
    expect(full.entities.map((e: { id: string }) => e.id)).toEqual(['VT1'])
    // Sửa bản ghi khác thì vẫn ghi được dù baseRev cũ.
    const other = await app.request('/api/changes', json({ baseRev: rev, changes: [{ c: 'teacher', id: 'VT2', data: teacher('VT2', 'Mới') }] }, b))
    expect(other.status).toBe(200)
  })

  it('lưu lịch sử ai sửa gì', async () => {
    const a = await signIn('a@gaia.vn', 'mat-khau-dai-1')
    const items = (await (await app.request('/api/history?c=teacher&id=VT1', { headers: { cookie: a } })).json()).items
    expect(items[0]).toMatchObject({ user: 'An', before: { name: 'An' }, after: { name: 'An sửa' } })
  })

  it('kiểm tra dữ liệu gửi lên', async () => {
    const a = await signIn('a@gaia.vn', 'mat-khau-dai-1')
    const bad = async (changes: unknown) => (await app.request('/api/changes', json({ baseRev: 0, changes }, a))).status
    expect(await bad([{ c: 'meta', id: 'seed', data: {} }])).toBe(400)
    expect(await bad([{ c: 'lesson', id: 'l1', data: { id: 'l1' } }])).toBe(400)
    expect(await bad([{ c: 'teacher', id: 'x', data: { id: 'y' } }])).toBe(400)
    expect(await bad([{ c: 'distance', id: 'home|a', data: 'xa' }])).toBe(400)
    expect(await bad([{ c: 'week', id: 'w', data: { id: 'w', lessons: [] } }])).toBe(400)
  })
})

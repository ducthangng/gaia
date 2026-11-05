import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import type { Db } from './db'

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>

export interface User {
  id: number
  email: string
  name: string
  role: 'admin' | 'editor'
}

export const SESSION_DAYS = 30

export async function hashPassword(password: string) {
  const salt = randomBytes(16)
  const hash = await scrypt(password, salt, 64)
  return ['scrypt', salt.toString('hex'), hash.toString('hex')].join('$')
}

export async function verifyPassword(password: string, stored: string) {
  const [kind, salt, hash] = stored.split('$')
  if (kind !== 'scrypt' || !salt || !hash) return false
  const got = await scrypt(password, Buffer.from(salt, 'hex'), 64)
  const want = Buffer.from(hash, 'hex')
  return got.length === want.length && timingSafeEqual(got, want)
}

const sha = (token: string) => createHash('sha256').update(token).digest('hex')

// Băm giả để thời gian trả lời như nhau dù email có tồn tại hay không.
const DUMMY = ['scrypt', '0'.repeat(32), '0'.repeat(128)].join('$')

export async function login(db: Db, email: string, password: string): Promise<{ user: User; token: string } | null> {
  const { rows } = await db.query('select id, email, name, role, password_hash, disabled from users where lower(email) = lower($1)', [email.trim()])
  const row = rows[0]
  const ok = await verifyPassword(password, row?.password_hash ?? DUMMY)
  if (!row || !ok || row.disabled) return null
  const token = randomBytes(32).toString('base64url')
  await db.query(`insert into sessions(token_hash, user_id, expires_at) values ($1, $2, now() + make_interval(days => $3))`, [sha(token), row.id, SESSION_DAYS])
  await db.query('delete from sessions where expires_at < now()')
  return { user: { id: row.id, email: row.email, name: row.name, role: row.role }, token }
}

export async function userForToken(db: Db, token: string): Promise<User | null> {
  const { rows } = await db.query(
    `select u.id, u.email, u.name, u.role from sessions s join users u on u.id = s.user_id
     where s.token_hash = $1 and s.expires_at > now() and not u.disabled`,
    [sha(token)],
  )
  return rows[0] ?? null
}

export async function logout(db: Db, token: string) {
  await db.query('delete from sessions where token_hash = $1', [sha(token)])
}

export async function createUser(db: Db, email: string, name: string, password: string, role: User['role']) {
  if (password.length < 10) throw new Error('Mật khẩu cần ít nhất 10 ký tự')
  const { rows } = await db.query(
    `insert into users(email, name, password_hash, role) values ($1, $2, $3, $4)
     on conflict (email) do update set name = excluded.name, password_hash = excluded.password_hash, role = excluded.role, disabled = false
     returning id`,
    [email.trim().toLowerCase(), name, await hashPassword(password), role],
  )
  // Đặt lại mật khẩu thì đăng xuất mọi phiên cũ.
  await db.query('delete from sessions where user_id = $1', [rows[0].id])
  return rows[0].id as number
}

export async function disableUser(db: Db, email: string) {
  const { rows } = await db.query('update users set disabled = true where lower(email) = lower($1) returning id', [email.trim()])
  if (rows[0]) await db.query('delete from sessions where user_id = $1', [rows[0].id])
  return rows.length > 0
}

/** Giới hạn số lần đăng nhập sai theo IP + email, giữ trong bộ nhớ (một instance là đủ cho quy mô này). */
export class LoginLimiter {
  private hits = new Map<string, { n: number; until: number }>()
  constructor(private max = 8, private windowMs = 15 * 60_000) {}
  blocked(key: string) {
    const h = this.hits.get(key)
    return !!h && h.until > Date.now() && h.n >= this.max
  }
  fail(key: string) {
    const h = this.hits.get(key)
    if (!h || h.until < Date.now()) this.hits.set(key, { n: 1, until: Date.now() + this.windowMs })
    else h.n++
  }
  reset(key: string) {
    this.hits.delete(key)
  }
}

export interface UserRow extends User {
  disabled: boolean
  createdAt: string
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Lỗi do dữ liệu người dùng nhập: trả 400 kèm thông báo. */
export class UserInputError extends Error {}

const USER_COLUMNS = 'id, email, name, role, disabled, created_at as "createdAt"'

export async function listUsers(db: Db): Promise<UserRow[]> {
  const { rows } = await db.query(`select ${USER_COLUMNS} from users order by disabled, lower(name)`)
  return rows
}

/** Tạo tài khoản từ giao diện admin. Khác createUser: email đã có thì báo lỗi, không đặt lại mật khẩu của người khác. */
export async function addUser(db: Db, input: Record<string, unknown>): Promise<UserRow> {
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : ''
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  const password = typeof input.password === 'string' ? input.password : ''
  const role = input.role === 'admin' ? 'admin' : 'editor'
  if (!EMAIL.test(email)) throw new UserInputError('Email không hợp lệ')
  if (!name) throw new UserInputError('Cần có tên')
  if (password.length < 10) throw new UserInputError('Mật khẩu cần ít nhất 10 ký tự')
  const { rows } = await db.query(
    `insert into users(email, name, password_hash, role) values ($1, $2, $3, $4)
     on conflict (email) do nothing returning ${USER_COLUMNS}`,
    [email, name, await hashPassword(password), role],
  )
  if (!rows[0]) throw new UserInputError(`Đã có tài khoản ${email}`)
  return rows[0]
}

/**
 * Sửa tài khoản: tên, vai trò, khoá/mở, đặt lại mật khẩu. Admin không tự khoá hay tự bỏ quyền admin được,
 * để hệ thống không bao giờ mất người quản trị. Đặt lại mật khẩu hoặc khoá thì đăng xuất mọi phiên của người đó.
 */
export async function updateUser(db: Db, actorId: number, id: number, input: Record<string, unknown>): Promise<UserRow> {
  const sets: string[] = []
  const args: unknown[] = []
  const add = (column: string, v: unknown) => {
    args.push(v)
    sets.push(`${column} = $` + args.length)
  }
  if (input.name !== undefined) {
    if (typeof input.name !== 'string' || !input.name.trim()) throw new UserInputError('Cần có tên')
    add('name', input.name.trim())
  }
  if (input.role !== undefined) {
    if (input.role !== 'admin' && input.role !== 'editor') throw new UserInputError('Vai trò không hợp lệ')
    if (id === actorId && input.role !== 'admin') throw new UserInputError('Không tự bỏ quyền admin của chính mình được')
    add('role', input.role)
  }
  if (input.disabled !== undefined) {
    if (typeof input.disabled !== 'boolean') throw new UserInputError('disabled không hợp lệ')
    if (id === actorId && input.disabled) throw new UserInputError('Không tự khoá tài khoản của chính mình được')
    add('disabled', input.disabled)
  }
  const resetPassword = input.password !== undefined
  if (resetPassword) {
    if (typeof input.password !== 'string' || input.password.length < 10) throw new UserInputError('Mật khẩu cần ít nhất 10 ký tự')
    add('password_hash', await hashPassword(input.password))
  }
  if (!sets.length) throw new UserInputError('Không có gì để sửa')
  args.push(id)
  const { rows } = await db.query(`update users set ${sets.join(', ')} where id = $` + args.length + ` returning ${USER_COLUMNS}`, args)
  if (!rows[0]) throw new UserInputError('Không có tài khoản này')
  if ((resetPassword && id !== actorId) || input.disabled === true) await db.query('delete from sessions where user_id = $1', [id])
  return rows[0]
}

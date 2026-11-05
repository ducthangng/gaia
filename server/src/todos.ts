import { UserInputError, type User } from './auth'
import type { Db } from './db'

export interface Todo {
  id: number
  title: string
  detail: string
  done: boolean
  reply: string
  createdAt: string
  updatedAt: string
  doneAt: string | null
  author: { id: number; name: string } | null
  doneBy: string | null
}

const SELECT = `
  select t.id, t.title, t.detail, t.done, t.reply,
         t.created_at as "createdAt", t.updated_at as "updatedAt", t.done_at as "doneAt",
         case when a.id is null then null else json_build_object('id', a.id, 'name', a.name) end as author,
         d.name as "doneBy"
  from todos t left join users a on a.id = t.created_by left join users d on d.id = t.done_by`

const text = (v: unknown, field: string, max: number, required: boolean) => {
  if (v === undefined && !required) return undefined
  if (typeof v !== 'string') throw new UserInputError(`${field} không hợp lệ`)
  const s = v.trim()
  if (required && !s) throw new UserInputError(`Cần có ${field}`)
  if (s.length > max) throw new UserInputError(`${field} dài quá ${max} ký tự`)
  return s
}

const one = async (db: Db, id: number): Promise<Todo> => {
  const { rows } = await db.query(`${SELECT} where t.id = $1`, [id])
  if (!rows[0]) throw new UserInputError('Không có việc này')
  return rows[0]
}

/** Việc chưa xong trước (mới nhất lên đầu), rồi tới việc đã xong (mới xong lên đầu). */
export async function listTodos(db: Db): Promise<Todo[]> {
  const { rows } = await db.query(`${SELECT} order by t.done, case when t.done then t.done_at else t.created_at end desc limit 500`)
  return rows
}

export async function addTodo(db: Db, user: User, input: Record<string, unknown>): Promise<Todo> {
  const title = text(input.title, 'tiêu đề', 300, true)!
  const detail = text(input.detail ?? '', 'mô tả', 5000, false) ?? ''
  const { rows } = await db.query('insert into todos(title, detail, created_by) values ($1, $2, $3) returning id', [title, detail, user.id])
  return one(db, rows[0].id)
}

/**
 * Người tạo sửa được tiêu đề, mô tả khi việc chưa xong; admin sửa được mọi lúc.
 * Chỉ admin đánh dấu xong / mở lại và ghi phản hồi.
 */
export async function updateTodo(db: Db, user: User, id: number, input: Record<string, unknown>): Promise<Todo> {
  const current = await one(db, id)
  const admin = user.role === 'admin'
  const own = current.author?.id === user.id
  const title = text(input.title, 'tiêu đề', 300, false)
  const detail = text(input.detail, 'mô tả', 5000, false)
  const reply = text(input.reply, 'phản hồi', 2000, false)
  const done = input.done
  if (done !== undefined && typeof done !== 'boolean') throw new UserInputError('done không hợp lệ')
  if ((title !== undefined || detail !== undefined) && !admin && !(own && !current.done)) throw new UserInputError('Chỉ người tạo sửa được, và chỉ khi việc chưa xong')
  if ((done !== undefined || reply !== undefined) && !admin) throw new UserInputError('Chỉ admin đánh dấu xong hoặc phản hồi')
  if (title === '') throw new UserInputError('Cần có tiêu đề')
  await db.query(
    `update todos set
       title = coalesce($2, title),
       detail = coalesce($3, detail),
       reply = coalesce($4, reply),
       done = coalesce($5, done),
       done_by = case when $5::boolean is null then done_by when $5 then $6 else null end,
       done_at = case when $5::boolean is null then done_at when $5 then coalesce(done_at, now()) else null end,
       updated_at = now()
     where id = $1`,
    [id, title ?? null, detail ?? null, reply ?? null, done ?? null, user.id],
  )
  return one(db, id)
}

/** Người tạo xoá được việc chưa xong của mình; admin xoá được mọi việc. */
export async function deleteTodo(db: Db, user: User, id: number) {
  const current = await one(db, id)
  if (user.role !== 'admin' && !(current.author?.id === user.id && !current.done)) throw new UserInputError('Chỉ người tạo xoá được, và chỉ khi việc chưa xong')
  await db.query('delete from todos where id = $1', [id])
}

import type { PoolClient } from 'pg'
import { tx, type Db } from './db'

/** Các loại bản ghi client được ghi. `meta` chỉ do script seed ghi. */
export const COLLECTIONS = ['teacher', 'school', 'office', 'leave', 'week', 'lesson', 'distance', 'kmOverride', 'settings'] as const
export type Collection = (typeof COLLECTIONS)[number] | 'meta'

export interface Entity {
  c: Collection
  id: string
  /** null = xoá */
  data: unknown
}

export interface Snapshot {
  rev: number
  entities: Entity[]
}

export type PushResult = { ok: true; rev: number; applied: number } | { ok: false; rev: number; conflicts: Entity[] }

const NUMERIC = new Set<string>(['distance', 'kmOverride'])
const isObj = (v: unknown) => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Kiểm tra hình dạng tối thiểu; nghiệp vụ nằm ở client (src/domain). Trả về lỗi đầu tiên hoặc null. */
export function validate(changes: unknown, allowMeta = false): string | null {
  if (!Array.isArray(changes)) return 'changes phải là mảng'
  if (changes.length > 20_000) return 'Quá nhiều thay đổi trong một lần lưu'
  const seen = new Set<string>()
  for (const ch of changes) {
    if (!isObj(ch)) return 'Thay đổi không hợp lệ'
    const { c, id, data } = ch as Entity
    if (!(COLLECTIONS as readonly string[]).includes(c) && !(allowMeta && c === 'meta')) return `Loại bản ghi không hợp lệ: ${String(c)}`
    if (typeof id !== 'string' || id.length === 0 || id.length > 300) return `id không hợp lệ (${c})`
    const key = `${c}|${id}`
    if (seen.has(key)) return `Trùng bản ghi trong một lần lưu: ${key}`
    seen.add(key)
    if (data === null) continue
    if (NUMERIC.has(c) ? typeof data !== 'number' || !Number.isFinite(data) : !isObj(data)) return `Dữ liệu không hợp lệ: ${key}`
    if (c !== 'distance' && c !== 'kmOverride' && c !== 'settings' && c !== 'meta' && (data as { id?: unknown }).id !== id) return `id trong dữ liệu không khớp: ${key}`
    if (c === 'lesson' && typeof (data as { weekId?: unknown }).weekId !== 'string') return `Ca thiếu weekId: ${id}`
    if (c === 'week' && 'lessons' in (data as object)) return `Tuần ${id} không được kèm lessons; gửi từng ca riêng`
  }
  return null
}

const currentRev = async (c: PoolClient | Db) => Number((await c.query('select coalesce(max(rev), 0) as rev from commits')).rows[0].rev)

/** Toàn bộ dữ liệu, hoặc chỉ những gì đổi sau `since` (gồm cả bản ghi đã xoá). */
export function read(db: Db, since?: number): Promise<Snapshot> {
  return tx(
    db,
    async (c) => {
      const rev = await currentRev(c)
      const { rows } =
        since === undefined
          ? await c.query('select collection as c, id, data from entities where data is not null order by pos')
          : await c.query('select collection as c, id, data from entities where rev > $1 order by pos', [since])
      return { rev, entities: rows }
    },
    'repeatable read',
  )
}

/**
 * Ghi một nhóm thay đổi nguyên khối. Bản ghi nào đã bị người khác sửa sau `baseRev`
 * (và khác với giá trị đang gửi) là sửa trùng: từ chối cả nhóm để client tải bản mới rồi gửi lại.
 */
export function push(db: Db, userId: number | null, baseRev: number, changes: Entity[], summary: string | null): Promise<PushResult> {
  return tx(db, async (c) => {
    // Ghi tuần tự: rev được cấp theo đúng thứ tự commit, client đọc `since` không bao giờ bỏ sót.
    await c.query('select pg_advisory_xact_lock(7428301)')
    const payload = JSON.stringify(changes)
    const rev = await currentRev(c)
    if (baseRev < rev) {
      const { rows } = await c.query(
        `select e.collection as c, e.id, e.data
         from jsonb_to_recordset($1::jsonb) as x(c text, id text, data jsonb)
         join entities e on e.collection = x.c and e.id = x.id
         where e.rev > $2 and e.data is distinct from x.data`,
        [payload, baseRev],
      )
      if (rows.length) return { ok: false as const, rev, conflicts: rows }
    }
    const { rows: commit } = await c.query('insert into commits(user_id, summary, size) values ($1, $2, $3) returning rev', [userId, summary?.slice(0, 500) ?? null, changes.length])
    const next = Number(commit[0].rev)
    const history = await c.query(
      `insert into entity_history(rev, collection, id, before, after)
       select $2, x.c, x.id, e.data, x.data
       from jsonb_to_recordset($1::jsonb) as x(c text, id text, data jsonb)
       left join entities e on e.collection = x.c and e.id = x.id
       where e.data is distinct from x.data and not (e.id is null and x.data is null)`,
      [payload, next],
    )
    if (!history.rowCount) {
      // Không có gì thực sự thay đổi: bỏ commit rỗng.
      await c.query('delete from commits where rev = $1', [next])
      return { ok: true as const, rev, applied: 0 }
    }
    await c.query(
      `insert into entities(collection, id, data, rev)
       select x.c, x.id, x.data, $2
       from jsonb_to_recordset($1::jsonb) as x(c text, id text, data jsonb)
       where x.data is not null or exists (select 1 from entities e where e.collection = x.c and e.id = x.id)
       on conflict (collection, id) do update set data = excluded.data, rev = excluded.rev
       where entities.data is distinct from excluded.data`,
      [payload, next],
    )
    return { ok: true as const, rev: next, applied: history.rowCount }
  })
}

export async function history(db: Db, limit: number) {
  const { rows } = await db.query(
    `select c.rev, c.at, c.summary, c.size, u.name as user
     from commits c left join users u on u.id = c.user_id
     order by c.rev desc limit $1`,
    [limit],
  )
  return rows.map((r) => ({ ...r, rev: Number(r.rev) }))
}

export async function entityHistory(db: Db, collection: string, id: string) {
  const { rows } = await db.query(
    `select h.rev, c.at, u.name as user, h.before, h.after
     from entity_history h join commits c on c.rev = h.rev left join users u on u.id = c.user_id
     where h.collection = $1 and h.id = $2 order by h.rev desc limit 100`,
    [collection, id],
  )
  return rows.map((r) => ({ ...r, rev: Number(r.rev) }))
}

import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

export type Db = pg.Pool

export function createPool(url: string): Db {
  const ssl = process.env.PGSSL === '1' ? { rejectUnauthorized: false } : undefined
  return new pg.Pool({ connectionString: url, ssl, max: 10 })
}

export async function tx<T>(db: Db, fn: (c: pg.PoolClient) => Promise<T>, isolation = 'read committed'): Promise<T> {
  const c = await db.connect()
  try {
    await c.query(`begin isolation level ${isolation}`)
    const out = await fn(c)
    await c.query('commit')
    return out
  } catch (e) {
    await c.query('rollback').catch(() => {})
    throw e
  } finally {
    c.release()
  }
}

const MIGRATIONS = fileURLToPath(new URL(process.env.MIGRATIONS_DIR ?? '../migrations/', import.meta.url))

/** Chạy các file migrations/*.sql chưa chạy, theo thứ tự tên, mỗi file trong một transaction. */
export async function migrate(db: Db, dir = MIGRATIONS) {
  await db.query('create table if not exists schema_migrations (name text primary key, at timestamptz not null default now())')
  const done = new Set((await db.query<{ name: string }>('select name from schema_migrations')).rows.map((r) => r.name))
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()
  for (const f of files) {
    if (done.has(f)) continue
    const sql = await readFile(`${dir}/${f}`, 'utf8')
    await tx(db, async (c) => {
      await c.query(sql)
      await c.query('insert into schema_migrations(name) values ($1)', [f])
    })
    console.log(`migrated ${f}`)
  }
}

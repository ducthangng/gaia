/**
 * Nạp seed JSON (do scripts/extract_workbook.py tạo) vào database.
 *
 *   DATABASE_URL=... npm run seed -- ../src/data/seed.local.json          # chỉ khi DB còn trống
 *   DATABASE_URL=... npm run seed -- ../src/data/seed.local.json --force  # thay toàn bộ, vẫn giữ lịch sử
 *
 * Trên máy cá nhân dùng DATABASE_PUBLIC_URL của Railway (DATABASE_URL nội bộ chỉ chạy được trong Railway).
 */
import { readFile } from 'node:fs/promises'
import { createPool, migrate } from '../src/db'
import { push, read, validate, type Entity } from '../src/store'

const args = process.argv.slice(2)
const file = args.find((a) => !a.startsWith('--'))
const force = args.includes('--force')
const url = process.env.DATABASE_PUBLIC_URL ?? process.env.DATABASE_URL
if (!file || !url) {
  console.error('Cách dùng: DATABASE_URL=... npm run seed -- <seed.json> [--force]')
  process.exit(1)
}

interface SeedFile {
  meta: { source: string; anonymized: boolean }
  offices: { id: string }[]
  teachers: { id: string }[]
  schools: { id: string }[]
  leaves: { id: string }[]
  weeks: ({ id: string; lessons: { id: string }[] } & Record<string, unknown>)[]
  distances: Record<'home' | 'office' | 'pair', Record<string, number>>
}

function seedEntities(seed: SeedFile): Entity[] {
  const out: Entity[] = [{ c: 'meta', id: 'seed', data: { source: seed.meta.source, anonymized: seed.meta.anonymized, loadedAt: new Date().toISOString() } }]
  for (const x of seed.offices) out.push({ c: 'office', id: x.id, data: x })
  for (const x of seed.teachers) out.push({ c: 'teacher', id: x.id, data: x })
  for (const x of seed.schools) out.push({ c: 'school', id: x.id, data: x })
  for (const x of seed.leaves) out.push({ c: 'leave', id: x.id, data: x })
  for (const { lessons, ...week } of seed.weeks) {
    out.push({ c: 'week', id: week.id, data: week })
    for (const l of lessons) out.push({ c: 'lesson', id: l.id, data: l })
  }
  for (const kind of ['home', 'office', 'pair'] as const) {
    for (const [k, km] of Object.entries(seed.distances[kind] ?? {})) out.push({ c: 'distance', id: `${kind}|${k}`, data: km })
  }
  return out
}

const seed = JSON.parse(await readFile(file, 'utf8')) as SeedFile
const db = createPool(url)
try {
  await migrate(db)
  const current = await read(db)
  if (current.entities.length && !force) {
    console.error(`Database đã có ${current.entities.length} bản ghi. Thêm --force để thay toàn bộ (lịch sử cũ vẫn được giữ).`)
    process.exit(1)
  }
  const fresh = seedEntities(seed)
  const keep = new Set(fresh.map((e) => `${e.c}|${e.id}`))
  const removed = current.entities.filter((e) => !keep.has(`${e.c}|${e.id}`)).map((e) => ({ ...e, data: null }))
  const changes = [...fresh, ...removed]
  const error = validate(changes, true)
  if (error) throw new Error(error)
  const res = await push(db, null, current.rev, changes, `Nạp seed ${seed.meta.source}${seed.meta.anonymized ? ' (ẩn danh)' : ''}`)
  if (!res.ok) throw new Error('Có người đang sửa dữ liệu, chạy lại sau')
  console.log(`Đã nạp ${fresh.length} bản ghi, xoá ${removed.length}, rev ${res.rev}. Dữ liệu ${seed.meta.anonymized ? 'ẩn danh' : 'THẬT (có SĐT, địa chỉ nhà)'}.`)
} finally {
  await db.end()
}

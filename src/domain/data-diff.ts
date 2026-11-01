import type { Distances, Leave, School, Seed, Settings, Teacher, Week } from './types'

export interface CurrentData {
  teachers: Teacher[]
  schools: School[]
  leaves: Leave[]
  weeks: Week[]
  kmOverrides: Record<string, number>
  settings: Settings
  distances: Distances
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

function compare<T>(now: T[], base: T[], key: (x: T) => string) {
  const before = new Map(base.map((x) => [key(x), x]))
  const after = new Set(now.map(key))
  return {
    added: now.filter((x) => !before.has(key(x))).length,
    edited: now.filter((x) => before.has(key(x)) && !same(x, before.get(key(x)))).length,
    removed: base.filter((x) => !after.has(key(x))).length,
  }
}

/** Liệt kê những gì sẽ mất nếu đưa dữ liệu về bản mới nhất, để người dùng biết trước khi bấm. */
export function dataDiff(now: CurrentData, seed: Seed, defaults: Settings): string[] {
  const out: string[] = []
  const t = compare(now.teachers, seed.teachers, (x) => x.id)
  if (t.added) out.push(`${t.added} giáo viên thêm mới`)
  if (t.edited) out.push(`${t.edited} giáo viên đã sửa thông tin`)
  if (t.removed) out.push(`${t.removed} giáo viên bị thiếu so với bản gốc`)
  const s = compare(now.schools, seed.schools, (x) => x.id)
  if (s.added) out.push(`${s.added} trường thêm mới`)
  if (s.edited) out.push(`${s.edited} trường đã sửa thông tin`)
  if (s.removed) out.push(`${s.removed} trường bị thiếu so với bản gốc`)
  const w = compare(now.weeks, seed.weeks, (x) => x.id)
  if (w.added) out.push(`${w.added} tuần tạo thêm`)
  if (w.removed) out.push(`${w.removed} tuần bị thiếu so với bản gốc`)
  let lessons = 0
  let weeksTouched = 0
  for (const week of now.weeks) {
    const base = seed.weeks.find((x) => x.id === week.id)
    if (!base) continue
    const c = compare(week.lessons, base.lessons, (x) => x.id)
    const n = c.added + c.edited + c.removed
    if (n || week.status !== base.status) weeksTouched++
    lessons += n
  }
  if (lessons) out.push(`${lessons} ca đã thêm, sửa hoặc xoá trong lịch tuần`)
  else if (weeksTouched) out.push(`${weeksTouched} tuần đã đổi trạng thái lưu trữ`)
  const l = compare(now.leaves, seed.leaves, (x) => x.id)
  if (l.added + l.removed) out.push(`${l.added + l.removed} ngày nghỉ đã thêm hoặc huỷ`)
  const km = Object.keys(now.kmOverrides).length
  if (km) out.push(`${km} số km sửa tay`)
  if (!same(now.distances, seed.distances)) out.push('Số km từ văn phòng hoặc từ nhà đã thay đổi')
  if (!same(now.settings, defaults)) out.push('Cấu hình chi phí và trọng số')
  return out
}

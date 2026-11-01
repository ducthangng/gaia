export type EntityKind = 'teacher' | 'school'

export type TextToken = { kind: 'text'; text: string } | { kind: EntityKind; id: string; text: string }

export interface EntityIndex {
  pattern: RegExp | null
  lookup: Map<string, { kind: EntityKind; id: string }>
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Chỉ mục để nhận ra giáo viên và trường trong câu chữ. Tên trùng nhau thì không đưa vào,
 * vì bấm vào mà mở nhầm người hoặc nhầm trường còn tệ hơn là không bấm được.
 */
export function buildEntityIndex(teachers: { id: string; name: string }[], schools: { id: string; fullName: string; name: string | null }[]): EntityIndex {
  const lookup = new Map<string, { kind: EntityKind; id: string }>()
  const count = new Map<string, number>()
  const bump = (k: string) => count.set(k, (count.get(k) ?? 0) + 1)
  for (const t of teachers) bump(t.name)
  for (const s of schools) if (s.name) bump(s.name)
  for (const t of teachers) {
    lookup.set(`${t.id} · ${t.name}`, { kind: 'teacher', id: t.id })
    lookup.set(t.id, { kind: 'teacher', id: t.id })
    if (t.name.length >= 4 && count.get(t.name) === 1) lookup.set(t.name, { kind: 'teacher', id: t.id })
  }
  for (const s of schools) {
    lookup.set(s.fullName, { kind: 'school', id: s.id })
    if (s.name && s.name.length >= 6 && count.get(s.name) === 1) lookup.set(s.name, { kind: 'school', id: s.id })
  }
  if (!lookup.size) return { pattern: null, lookup }
  // Dài trước để "TH A - B" được ưu tiên hơn "TH A".
  const alternatives = [...lookup.keys()].sort((a, b) => b.length - a.length).map(escapeRe).join('|')
  return { pattern: new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives})(?![\\p{L}\\p{N}])`, 'gu'), lookup }
}

export function tokenizeEntities(text: string, index: EntityIndex): TextToken[] {
  if (!text) return []
  if (!index.pattern) return [{ kind: 'text', text }]
  const out: TextToken[] = []
  let at = 0
  for (const m of text.matchAll(index.pattern)) {
    const start = m.index
    if (start > at) out.push({ kind: 'text', text: text.slice(at, start) })
    const hit = index.lookup.get(m[0])!
    out.push({ kind: hit.kind, id: hit.id, text: m[0] })
    at = start + m[0].length
  }
  if (at < text.length) out.push({ kind: 'text', text: text.slice(at) })
  return out
}

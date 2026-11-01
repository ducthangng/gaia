import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { seed } from './data/load'
import { rankCandidates } from './domain/recommend'
import { buildContext, type World } from './domain/context'
import { kmKey, routeForWeek } from './domain/route'
import { addDays, weekDates } from './domain/time'
import { DEFAULT_SETTINGS, needsTeacher, type Lesson, type Leave, type School, type Session, type Settings, type Teacher, type Week } from './domain/types'
import { cloneWeek } from './domain/weeks'
import { applyLeave, revertLeave } from './domain/leave'
import { subjectCode, type OcrRow } from './domain/ocr-parse'
import type { ParsedLesson, ParsedTeacher, PreferenceRow } from './domain/sheet-grid'

interface State extends World {
  weeks: Week[]
  activeWeekId: string
  anonymized: boolean
  nextId: number
  setActiveWeek: (id: string) => void
  assign: (lessonId: string, teacherId: string) => void
  requestCover: (lessonId: string) => void
  markSchoolOff: (lessonId: string, off: boolean) => void
  autoFill: () => { filled: number; left: number }
  addLeave: (teacherId: string, from: string, to: string, session: Session | 'ALL', note: string) => number
  removeLeave: (id: string) => void
  updateTeacher: (id: string, patch: Partial<Teacher>) => void
  updateSchool: (id: string, patch: Partial<School>) => void
  toggleRefer: (schoolId: string, teacherId: string) => void
  setKmOverride: (weekId: string, teacherId: string, date: string, toSchoolId: string, km: number | null) => void
  planNewWeek: (sourceId: string) => string
  archiveWeek: (id: string) => void
  reopenWeek: (id: string) => void
  applyOcr: (weekId: string, schoolId: string, rows: OcrRow[], removeIds: string[]) => { added: number; updated: number; removed: number }
  applySheetWeek: (monday: string, label: string, teachers: ParsedTeacher[], lessons: ParsedLesson[]) => { weekId: string; newTeachers: number; newSchools: number }
  applyPreferences: (rows: PreferenceRow[]) => number
  applyRefer: (rows: { school: string; teacherId: string }[]) => { applied: number; unknown: string[] }
  updateSettings: (patch: Partial<Settings>) => void
  resetAll: () => void
}

const initial = () => ({
  teachers: seed.teachers,
  schools: seed.schools,
  offices: seed.offices,
  leaves: seed.leaves,
  distances: seed.distances,
  weeks: seed.weeks,
  settings: DEFAULT_SETTINGS,
  kmOverrides: {} as Record<string, number>,
  activeWeekId: seed.weeks.at(-1)!.id,
  anonymized: seed.meta.anonymized,
  nextId: 1,
})

const normName = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase()
const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const OFFICE_OF = (v: string | null) => (v && /phú mỹ/i.test(v) ? 'PM' : 'BR')

export const useStore = create<State>()(
  persist(
    (set, get) => {
      /** Sửa lịch tuần đang lập; tuần đã lưu trữ thì không ghi gì cả. */
      const editWeek = (weekId: string, fn: (lessons: Lesson[]) => Lesson[]) =>
        set((s) => ({ weeks: s.weeks.map((w) => (w.id === weekId && w.status === 'planning' ? { ...w, lessons: fn(w.lessons) } : w)) }))
      const editLesson = (id: string, fn: (l: Lesson) => Lesson) => {
        const week = get().weeks.find((w) => w.lessons.some((l) => l.id === id))
        if (week) editWeek(week.id, (ls) => ls.map((l) => (l.id === id ? fn(l) : l)))
      }
      const newId = (prefix: string) => {
        const n = get().nextId
        set({ nextId: n + 1 })
        return `${prefix}${n}`
      }
      return {
        ...initial(),
        setActiveWeek: (id) => set({ activeWeekId: id }),

        assign: (lessonId, teacherId) =>
          editLesson(lessonId, (l) => ({
            ...l,
            teacherId,
            status: 'assigned',
            // Giữ GV gốc để biết đây là ca dạy thay; gán lại đúng GV gốc thì trở về ca thường.
            originalTeacherId: l.originalTeacherId === teacherId ? null : l.originalTeacherId,
            type: l.originalTeacherId && l.originalTeacherId !== teacherId ? 'substitute' : l.originalTeacherId === teacherId ? 'regular' : l.type,
          })),

        requestCover: (lessonId) =>
          editLesson(lessonId, (l) => ({ ...l, originalTeacherId: l.originalTeacherId ?? l.teacherId, teacherId: null, status: 'needs_cover' })),

        markSchoolOff: (lessonId, off) =>
          editLesson(lessonId, (l) => ({ ...l, status: off ? 'school_off' : l.teacherId ? 'assigned' : 'needs_cover' })),

        autoFill: () => {
          let filled = 0
          let left = 0
          const week = get().weeks.find((w) => w.id === get().activeWeekId)
          if (!week || week.status !== 'planning') return { filled, left }
          // Điền lần lượt, mỗi ca dựng lại ngữ cảnh để ca sau thấy phân công của ca trước.
          for (const l of week.lessons.filter((x) => x.status === 'needs_cover' || (!x.teacherId && x.status === 'assigned' && needsTeacher(x)))) {
            const current = get().weeks.find((w) => w.id === week.id)!
            const best = rankCandidates(l, buildContext(current, get())).find((c) => c.available && c.violations.length === 0 && c.taughtSubject)
            if (best) {
              get().assign(l.id, best.teacher.id)
              filled++
            } else left++
          }
          return { filled, left }
        },

        addLeave: (teacherId, from, to, session, note) => {
          const add: Leave[] = []
          const sessions: Session[] = session === 'ALL' ? ['AM', 'PM'] : [session]
          const existing = get().leaves
          for (let d = from; d <= to; d = addDays(d, 1)) {
            for (const sess of sessions) {
              if (!existing.some((x) => x.teacherId === teacherId && x.date === d && x.session === sess)) {
                add.push({ id: newId('lv-new-'), teacherId, date: d, session: sess, kind: 'leave', note: note || 'Nghỉ phép' })
              }
            }
          }
          set((s) => ({ leaves: [...s.leaves, ...add] }))
          const range = { teacherId, from, to, sessions }
          let flagged = 0
          for (const w of get().weeks.filter((x) => x.status === 'planning')) {
            editWeek(w.id, (ls) => {
              const next = applyLeave(ls, range)
              flagged += next.filter((l, i) => l !== ls[i]).length
              return next
            })
          }
          return flagged
        },

        removeLeave: (id) => {
          const leave = get().leaves.find((l) => l.id === id)
          if (!leave) return
          set((s) => ({ leaves: s.leaves.filter((l) => l.id !== id) }))
          const range = { teacherId: leave.teacherId, from: leave.date, to: leave.date, sessions: [leave.session] }
          for (const w of get().weeks.filter((x) => x.status === 'planning')) editWeek(w.id, (ls) => revertLeave(ls, range))
        },
        updateTeacher: (id, patch) => set((s) => ({ teachers: s.teachers.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
        updateSchool: (id, patch) => set((s) => ({ schools: s.schools.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),

        toggleRefer: (schoolId, teacherId) =>
          set((s) => ({
            schools: s.schools.map((x) =>
              x.id === schoolId
                ? { ...x, referSource: 'confirmed', referredTeacherIds: x.referredTeacherIds.includes(teacherId) ? x.referredTeacherIds.filter((t) => t !== teacherId) : [...x.referredTeacherIds, teacherId] }
                : x,
            ),
          })),

        setKmOverride: (weekId, teacherId, date, toSchoolId, km) =>
          set((s) => {
            const next = { ...s.kmOverrides }
            const key = kmKey(weekId, teacherId, date, toSchoolId)
            if (km === null) delete next[key]
            else next[key] = km
            return { kmOverrides: next }
          }),

        planNewWeek: (sourceId) => {
          const { weeks, leaves } = get()
          const source = weeks.find((w) => w.id === sourceId)!
          const lastStart = weeks.map((w) => w.startDate).sort().at(-1)!
          const week = cloneWeek(source, addDays(lastStart, 7), leaves, () => newId('n'))
          set({ weeks: [...weeks, week], activeWeekId: week.id })
          return week.id
        },
        archiveWeek: (id) => set((s) => ({ weeks: s.weeks.map((w) => (w.id === id ? { ...w, status: 'archived', legs: frozenLegs(w, s) } : w)) })),
        reopenWeek: (id) => set((s) => ({ weeks: s.weeks.map((w) => (w.id === id ? { ...w, status: 'planning' } : w)) })),

        applyOcr: (weekId, schoolId, rows, removeIds) => {
          const week = get().weeks.find((w) => w.id === weekId)!
          let added = 0
          let updated = 0
          const fresh: Lesson[] = []
          const lessons = week.lessons.filter((l) => !removeIds.includes(l.id)).map((l) => ({ ...l }))
          for (const r of rows) {
            if (r.day === null) continue
            const date = weekDates(week.startDate)[r.day]
            const match = findExisting(lessons, schoolId, date, r)
            if (match) {
              if (match.start !== r.start || match.end !== r.end || match.subject !== r.subject) {
                Object.assign(match, { start: r.start, end: r.end, subject: r.subject ?? match.subject, session: sessionOf(r.start) })
                updated++
              }
            } else {
              fresh.push({
                id: newId('o'), weekId, teacherId: null, originalTeacherId: null, schoolId, date, session: sessionOf(r.start), period: 1, track: 0,
                className: r.className, subject: r.subject, start: r.start, end: r.end, code: subjectCode(r.subject), company: null, note: 'Từ ảnh OCR', type: 'regular', status: 'needs_cover',
              })
              added++
            }
          }
          editWeek(weekId, () => [...lessons, ...fresh])
          return { added, updated, removed: removeIds.length }
        },

        applySheetWeek: (monday, label, teachers, lessons) => {
          const state = get()
          const known = new Set(state.teachers.map((t) => t.id))
          const addTeachers: Teacher[] = teachers.filter((t) => !known.has(t.id)).map((t) => ({
            id: t.id, name: t.name, phone: t.phone, district: t.district?.toUpperCase() ?? null, address: t.address, officeId: OFFICE_OF(t.office),
            isCollaborator: t.id.startsWith('CTV'), isManager: false, active: true, track: null, subjects: [], gender: null, maxKm: null, areas: [], onlineOnly: false, preferences: [],
          }))
          const bySchool = new Map(state.schools.map((s) => [normName(s.fullName), s.id]))
          const addSchools: School[] = []
          for (const l of lessons) {
            const key = normName(l.schoolName)
            if (!bySchool.has(key)) {
              const parts = l.schoolName.split(/\s[-–]\s/)
              const id = slug(l.schoolName)
              bySchool.set(key, id)
              addSchools.push({ id, fullName: l.schoolName, name: parts[0], region: parts[1] ?? null, address: null, consultant: null, isExternal: false, programs: [], referredTeacherIds: [], referSource: 'derived' })
            }
          }
          const week: Week = {
            id: monday, label, startDate: monday, endDate: addDays(monday, 6), status: 'planning', legs: [],
            lessons: lessons.map(({ schoolName, ...l }) => ({ ...l, id: newId('s'), weekId: monday, schoolId: bySchool.get(normName(schoolName))! })),
          }
          set((s) => ({
            teachers: [...s.teachers, ...addTeachers],
            schools: [...s.schools, ...addSchools],
            weeks: [...s.weeks.filter((w) => w.id !== monday), week].sort((a, b) => a.startDate.localeCompare(b.startDate)),
            activeWeekId: monday,
          }))
          return { weekId: monday, newTeachers: addTeachers.length, newSchools: addSchools.length }
        },

        applyPreferences: (rows) => {
          let n = 0
          set((s) => ({
            teachers: s.teachers.map((t) => {
              const r = rows.find((x) => x.teacherId === t.id)
              if (!r) return t
              n++
              const fromSheet = [
                ...(r.finishBy ? [{ id: `sheet-f-${t.id}`, type: 'finishBy' as const, time: r.finishBy }] : []),
                ...(r.noSession ? [{ id: `sheet-n-${t.id}`, type: 'noSession' as const, session: r.noSession }] : []),
              ]
              return { ...t, gender: r.gender ?? t.gender, maxKm: r.maxKm ?? t.maxKm, preferences: [...t.preferences.filter((p) => !p.id.startsWith('sheet-')), ...fromSheet] }
            }),
          }))
          return n
        },

        applyRefer: (rows) => {
          const unknown = new Set<string>()
          let applied = 0
          const bySchool = new Map<string, string[]>()
          for (const r of rows) bySchool.set(normName(r.school), [...(bySchool.get(normName(r.school)) ?? []), r.teacherId])
          const names = new Set(get().schools.map((s) => normName(s.fullName)))
          for (const r of rows) {
            if (names.has(normName(r.school))) applied++
            else unknown.add(r.school)
          }
          set((s) => ({
            schools: s.schools.map((x) => {
              const ids = bySchool.get(normName(x.fullName))
              return ids ? { ...x, referredTeacherIds: ids, referSource: 'confirmed' as const } : x
            }),
          }))
          return { applied, unknown: [...unknown] }
        },

        updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
        resetAll: () => set(initial()),
      }
    },
    {
      name: 'gaia-scheduling',
      version: 3,
      // Bản lưu cũ: giữ lịch và các chỉnh sửa của điều phối, nạp thêm địa chỉ, toạ độ, khu vực mới.
      migrate: (persisted) => {
        const p = persisted as Partial<State>
        const oldTeachers = new Map((p.teachers ?? []).map((t) => [t.id, t]))
        const oldSchools = new Map((p.schools ?? []).map((x) => [x.id, x]))
        return {
          ...p,
          offices: seed.offices,
          distances: seed.distances,
          teachers: seed.teachers.map((t) => {
            const old = oldTeachers.get(t.id)
            return old ? { ...t, gender: old.gender, maxKm: old.maxKm, preferences: old.preferences } : t
          }),
          schools: seed.schools.map((x) => {
            const old = oldSchools.get(x.id)
            return old ? { ...x, referredTeacherIds: old.referredTeacherIds, referSource: old.referSource, genderPreference: old.genderPreference, geo: old.geo?.source === 'manual' ? old.geo : x.geo } : x
          }),
        } as State
      },
      storage: createJSONStorage(() => localStorage),
      partialize: ({ teachers, schools, offices, leaves, distances, weeks, settings, kmOverrides, activeWeekId, nextId, anonymized }) => ({ teachers, schools, offices, leaves, distances, weeks, settings, kmOverrides, activeWeekId, nextId, anonymized }),
      // Bản lưu từ seed khác (ẩn danh <-> dữ liệu thật) thì bỏ, tránh lẫn dữ liệu.
      merge: (persisted, current) => {
        const p = persisted as Partial<State> | undefined
        return p && p.anonymized === seed.meta.anonymized ? { ...current, ...p } : current
      },
    },
  ),
)

const sessionOf = (start: string | null): Session => (start && start >= '12:00' ? 'PM' : 'AM')

const findExisting = (lessons: Lesson[], schoolId: string, date: string, r: OcrRow) =>
  lessons.find((l) => l.schoolId === schoolId && l.date === date && l.className === r.className && l.className !== null && (l.subject === r.subject || !r.subject || !l.subject))

/** Khoá số km và chi phí lúc lưu trữ để tuần cũ không đổi khi biểu giá thay đổi về sau. */
function frozenLegs(week: Week, world: World): Week['legs'] {
  const ctx = buildContext(week, world)
  return world.teachers.flatMap((t) =>
    weekDates(week.startDate).flatMap((date) =>
      deriveFrozen(t, date, week, ctx),
    ),
  )
}

function deriveFrozen(t: Teacher, date: string, week: Week, ctx: ReturnType<typeof buildContext>): Week['legs'] {
  return routeForWeek(week, t, date, ctx).legs.map((l) => ({ teacherId: t.id, date, session: l.session, period: l.period, start: l.start, km: l.km, cost: l.cost }))
}

export const useWorld = (): World => {
  const s = useStore()
  return s
}

export const useActiveWeek = () => useStore((s) => s.weeks.find((w) => w.id === s.activeWeekId) ?? s.weeks.at(-1)!)

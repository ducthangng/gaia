import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { seed } from './data/load'
import { rankCandidates } from './domain/recommend'
import { buildContext, type World } from './domain/context'
import { kmKey, routeForWeek } from './domain/route'
import { addDays, weekDates } from './domain/time'
import { DEFAULT_SETTINGS, needsTeacher, type Lesson, type Leave, type School, type Session, type RecordedLeg, type Settings, type Teacher, type Week } from './domain/types'
import { cloneWeek } from './domain/weeks'
import { applyDraft, applyBulk, newLesson, type BulkAction, type BulkScope, type LessonDraft } from './domain/lesson-edit'
import { applyLeave, applyLessonLeave, revertLeave, revertLessonLeave } from './domain/leave'
import { createSchool, createTeacher, type SchoolDraft } from './domain/create-records'
import { applySchoolAddress } from './domain/data-quality'
import { applyChanges, type Change } from './domain/optimize'
import { applyProfile, dropHomeKm, dropHomeLegs, type ProfileDraft } from './domain/teacher-profile'
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
  lastEdit: { weekId: string; lessons: Lesson[]; label: string } | null
  saveLesson: (id: string, draft: LessonDraft) => void
  addLesson: (schoolId: string, draft: LessonDraft) => void
  deleteLesson: (id: string) => void
  applyBulkChange: (scope: BulkScope, action: BulkAction) => number
  undoLastEdit: () => void
  applySuggestion: (changes: Change[]) => void
  replaceTeacher: (lessonId: string, teacherId: string) => void
  saveTeacherProfile: (id: string, draft: ProfileDraft) => void
  saveSchoolAddress: (id: string, address: string) => void
  addTeacher: (id: string, draft: ProfileDraft) => string
  addSchool: (draft: SchoolDraft) => string
  deleteNewTeacher: (id: string) => boolean
  deleteNewSchool: (id: string) => boolean
  setOfficeKm: (officeId: string, schoolId: string, km: number | null) => void
  addLeave: (teacherId: string, from: string, to: string, session: Session | 'ALL', note: string) => number
  addLessonLeave: (teacherId: string, lessonIds: string[], note: string) => number
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
  /** Bản ngay trước khi đưa về dữ liệu mới nhất, chỉ giữ trong phiên để hoàn tác. */
  beforeReset: Partial<State> | null
  undoReset: () => void
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

const DATA_VERSION = 6
/** Bản lưu cũ hơn số này thì bỏ và nạp lại từ seed; từ số này trở đi được nâng cấp, giữ nguyên chỉnh sửa. */
const OLDEST_KEPT_VERSION = 4

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
      /** Giữ lịch trước khi sửa để có thể hoàn tác một bước. */
      const snapshot = (weekId: string, label: string) => {
        const week = get().weeks.find((w) => w.id === weekId)
        if (week) set({ lastEdit: { weekId, lessons: week.lessons, label } })
      }
      const weekOf = (id: string) => get().weeks.find((w) => w.lessons.some((l) => l.id === id))
      return {
        ...initial(),
        lastEdit: null,
        setActiveWeek: (id) => set({ activeWeekId: id }),

        saveLesson: (id, draft) => {
          const week = weekOf(id)
          if (!week) return
          snapshot(week.id, 'Sửa ca')
          editWeek(week.id, (ls) => ls.map((l) => (l.id === id ? applyDraft(l, draft) : l)))
        },
        addLesson: (schoolId, draft) => {
          const weekId = get().activeWeekId
          snapshot(weekId, 'Thêm ca')
          const lesson = newLesson(newId('e'), weekId, schoolId, draft)
          editWeek(weekId, (ls) => [...ls, lesson])
        },
        deleteLesson: (id) => {
          const week = weekOf(id)
          if (!week) return
          snapshot(week.id, 'Xoá ca')
          editWeek(week.id, (ls) => ls.filter((l) => l.id !== id))
        },
        applyBulkChange: (scope, action) => {
          const weekId = get().activeWeekId
          const week = get().weeks.find((w) => w.id === weekId)
          if (!week) return 0
          const next = applyBulk(week.lessons, scope, action)
          const changed = next.filter((l, i) => l !== week.lessons[i]).length
          if (changed) {
            snapshot(weekId, 'Đổi lịch hàng loạt')
            editWeek(weekId, () => next)
          }
          return changed
        },
        replaceTeacher: (lessonId, teacherId) => {
          const week = weekOf(lessonId)
          if (!week) return
          snapshot(week.id, 'Đổi giáo viên')
          get().assign(lessonId, teacherId)
        },
        applySuggestion: (changes) => {
          const weekId = get().activeWeekId
          snapshot(weekId, 'Áp dụng đề xuất')
          editWeek(weekId, (ls) => applyChanges(ls, changes))
        },
        saveTeacherProfile: (id, draft) => {
          const old = get().teachers.find((t) => t.id === id)
          if (!old) return
          const next = applyProfile(old, draft, seed.places ?? [])
          set((s) => ({ teachers: s.teachers.map((t) => (t.id === id ? next : t)) }))
          if (next.address !== old.address) {
            // Tuần đã lưu trữ giữ nguyên số đã chốt; tuần đang lập tính lại theo địa chỉ mới.
            set((s) => ({
              distances: dropHomeKm(s.distances, id),
              weeks: s.weeks.map((w) => (w.status === 'planning' ? { ...w, legs: dropHomeLegs(w.legs, id) } : w)),
            }))
          }
        },
        addTeacher: (id, draft) => {
          const teacher = createTeacher(id, draft, seed.places ?? [])
          set((s) => ({ teachers: [...s.teachers, teacher] }))
          return teacher.id
        },
        addSchool: (draft) => {
          const school = createSchool(draft, get().schools, seed.places ?? [])
          set((s) => ({ schools: [...s.schools, school] }))
          return school.id
        },
        // Chỉ xoá được hồ sơ thêm nhầm: chưa từng có ca nào thì không làm mất dữ liệu lịch.
        deleteNewTeacher: (id) => {
          const { teachers, weeks } = get()
          const t = teachers.find((x) => x.id === id)
          if (!t?.isNew || weeks.some((w) => w.lessons.some((l) => l.teacherId === id || l.originalTeacherId === id))) return false
          set((s) => ({
            teachers: s.teachers.filter((x) => x.id !== id),
            leaves: s.leaves.filter((l) => l.teacherId !== id),
            schools: s.schools.map((x) => (x.referredTeacherIds.includes(id) ? { ...x, referredTeacherIds: x.referredTeacherIds.filter((r) => r !== id) } : x)),
          }))
          return true
        },
        deleteNewSchool: (id) => {
          const { schools, weeks } = get()
          const x = schools.find((s) => s.id === id)
          if (!x?.isNew || weeks.some((w) => w.lessons.some((l) => l.schoolId === id))) return false
          set((s) => ({
            schools: s.schools.filter((y) => y.id !== id),
            distances: { ...s.distances, office: Object.fromEntries(Object.entries(s.distances.office).filter(([k]) => !k.endsWith(`|${id}`))) },
          }))
          return true
        },
        saveSchoolAddress: (id, address) =>
          set((s) => ({ schools: s.schools.map((x) => (x.id === id ? applySchoolAddress(x, address, seed.places ?? []) : x)) })),
        setOfficeKm: (officeId, schoolId, km) =>
          set((s) => {
            const office = { ...s.distances.office }
            const key = `${officeId}|${schoolId}`
            if (km === null) delete office[key]
            else office[key] = km
            return { distances: { ...s.distances, office } }
          }),
        undoLastEdit: () => {
          const last = get().lastEdit
          if (!last) return
          editWeek(last.weekId, () => last.lessons)
          set({ lastEdit: null })
        },

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
              if (!existing.some((x) => x.teacherId === teacherId && x.date === d && x.session === sess && x.lessonId === undefined)) {
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

        addLessonLeave: (teacherId, lessonIds, note) => {
          const picked = get().weeks.filter((w) => w.status === 'planning').flatMap((w) => w.lessons).filter((l) => lessonIds.includes(l.id) && l.teacherId === teacherId && l.status === 'assigned')
          const add: Leave[] = picked.map((l) => ({
            id: newId('lv-new-'), teacherId, date: l.date, session: l.session, kind: 'leave', note: note || 'Nghỉ phép', lessonId: l.id, start: l.start ?? undefined, end: l.end ?? undefined, label: l.className ?? l.note ?? undefined,
          }))
          set((s) => ({ leaves: [...s.leaves, ...add] }))
          for (const w of get().weeks.filter((x) => x.status === 'planning')) editWeek(w.id, (ls) => applyLessonLeave(ls, teacherId, lessonIds))
          return picked.length
        },

        removeLeave: (id) => {
          const leave = get().leaves.find((l) => l.id === id)
          if (!leave) return
          set((s) => ({ leaves: s.leaves.filter((l) => l.id !== id) }))
          if (leave.lessonId) {
            for (const w of get().weeks.filter((x) => x.status === 'planning')) editWeek(w.id, (ls) => revertLessonLeave(ls, leave.teacherId, leave.lessonId!))
            return
          }
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
        beforeReset: null,
        resetAll: () => {
          const { teachers, schools, offices, leaves, distances, weeks, settings, kmOverrides, activeWeekId, nextId } = get()
          set({ ...initial(), lastEdit: null, beforeReset: { teachers, schools, offices, leaves, distances, weeks, settings, kmOverrides, activeWeekId, nextId } })
        },
        undoReset: () => {
          const saved = get().beforeReset
          if (saved) set({ ...saved, beforeReset: null })
        },
      }
    },
    {
      name: 'gaia-scheduling',
      // Tăng số này khi muốn mọi trình duyệt bỏ dữ liệu đã sửa và nạp lại từ seed trong lần tải tiếp theo.
      version: DATA_VERSION,
      migrate: (persisted, version) => {
        if (version < OLDEST_KEPT_VERSION) return {} as State
        // v5: thêm trường đến cho các chặng đã ghi, không đụng tới chỉnh sửa của người dùng.
        const p = persisted as State
        const key = (l: RecordedLeg) => `${l.teacherId}|${l.date}|${l.session}|${l.period}|${l.start}`
        const known = new Map(seed.weeks.flatMap((w) => w.legs).map((l) => [key(l), l.toSchoolId]))
        // v6: bản demo có tên giáo viên thật; chỉ thay tên giữ chỗ, không đè tên đã được sửa tay.
        const names = new Map(seed.teachers.map((t) => [t.id, t.name]))
        return {
          ...p,
          teachers: p.teachers.map((t) => (t.name === `Giáo viên ${t.id}` && names.has(t.id) ? { ...t, name: names.get(t.id)! } : t)),
          weeks: p.weeks.map((w) => ({ ...w, legs: w.legs.map((l) => ({ ...l, toSchoolId: l.toSchoolId ?? known.get(key(l)) ?? null })) })),
        }
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
  return routeForWeek(week, t, date, ctx).legs.map((l) => ({ teacherId: t.id, date, session: l.session, period: l.period, start: l.start, km: l.km, cost: l.cost, toSchoolId: l.toSchoolId }))
}

export const useWorld = (): World => {
  const s = useStore()
  return s
}

export const useActiveWeek = () => useStore((s) => s.weeks.find((w) => w.id === s.activeWeekId) ?? s.weeks.at(-1)!)

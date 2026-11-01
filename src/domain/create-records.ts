import { applySchoolAddress } from './data-quality'
import { applyProfile, type ProfileDraft } from './teacher-profile'
import type { Place, School, Teacher } from './types'

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/\s+/g, ' ').trim()
const slug = (s: string) => fold(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/** Mã kế tiếp sau mã VT lớn nhất, kể cả của giáo viên đã nghỉ, để không dùng lại mã cũ. */
export function nextTeacherId(teachers: Pick<Teacher, 'id'>[]) {
  const max = Math.max(0, ...teachers.map((t) => Number(t.id.match(/^VT(\d+)$/)?.[1] ?? 0)))
  return `VT${String(max + 1).padStart(3, '0')}`
}

export function teacherIdError(id: string, teachers: Pick<Teacher, 'id'>[]): string | null {
  const code = id.trim().toUpperCase()
  if (!code) return 'Cần có mã giáo viên'
  if (!/^[A-Z0-9]+$/.test(code)) return 'Mã chỉ gồm chữ không dấu và số, ví dụ VT050'
  return teachers.some((t) => t.id.toUpperCase() === code) ? `Mã ${code} đã có người dùng` : null
}

export const emptyProfile = (officeId: string): ProfileDraft => ({
  name: '', phone: '', address: '', district: '', officeId, track: '', areas: [], gender: '', maxKm: '', onlineOnly: false,
})

export function createTeacher(id: string, d: ProfileDraft, places: Place[]): Teacher {
  const code = id.trim().toUpperCase()
  const blank: Teacher = {
    id: code, name: '', phone: null, district: null, address: null, officeId: d.officeId, isCollaborator: code.startsWith('CTV'), isManager: false,
    active: true, track: null, subjects: [], gender: null, maxKm: null, areas: [], onlineOnly: false, preferences: [], isNew: true,
  }
  return applyProfile(blank, d, places)
}

export interface SchoolDraft {
  name: string
  region: string
  address: string
  consultant: string
}

export const schoolFullName = (d: Pick<SchoolDraft, 'name' | 'region'>) => (d.region.trim() ? `${d.name.trim()} - ${d.region.trim()}` : d.name.trim())

export function schoolDraftErrors(d: SchoolDraft, schools: School[]): string[] {
  const out: string[] = []
  if (!d.name.trim()) out.push('Cần có tên trường')
  if (!d.region.trim()) out.push('Cần có khu vực')
  if (!out.length) {
    const full = fold(schoolFullName(d))
    const same = schools.find((s) => fold(s.fullName) === full)
    if (same) out.push(`Đã có trường "${same.fullName}"`)
    // Trường trùng tên bắt buộc phân biệt bằng địa chỉ cụ thể.
    else if (!d.address.trim() && schools.some((s) => s.name && fold(s.name) === fold(d.name))) out.push('Đã có trường cùng tên ở khu vực khác, cần nhập địa chỉ cụ thể để phân biệt')
  }
  return out
}

export function createSchool(d: SchoolDraft, schools: School[], places: Place[]): School {
  const fullName = schoolFullName(d)
  const base = slug(fullName) || 'truong'
  let id = base
  for (let i = 2; schools.some((s) => s.id === id); i++) id = `${base}-${i}`
  const blank: School = {
    id, fullName, name: d.name.trim(), region: d.region.trim(), address: null, consultant: d.consultant.trim() || null, isExternal: false,
    programs: [], referredTeacherIds: [], referSource: 'confirmed', isNew: true,
  }
  return applySchoolAddress(blank, d.address, places)
}

export type Session = 'AM' | 'PM'
export type LessonStatus = 'assigned' | 'needs_cover' | 'replaced' | 'school_off' | 'cancelled'
export type LessonType = 'regular' | 'substitute' | 'makeup' | 'support' | 'event' | 'observe'
export type StartType = 'N' | 'V' | 'K'
export type Gender = 'F' | 'M'

export interface GeoPoint {
  lat: number
  lng: number
  /** pluscode, street, manual: dùng được để đo. region, ward: chỉ là tâm khu vực hoặc phường/xã. */
  source: 'pluscode' | 'street' | 'region' | 'manual' | 'ward'
}

export interface Lesson {
  id: string
  weekId: string
  teacherId: string | null
  /** GV dạy gốc khi ca đang được dạy thay hoặc đang cần cover. */
  originalTeacherId: string | null
  schoolId: string
  date: string
  session: Session
  period: number
  track: number
  className: string | null
  subject: string | null
  start: string | null
  end: string | null
  /** Mã quy đổi tiết của workbook: K, S, C, K/2, CM, BCTH... */
  code: string | null
  company: string | null
  note: string | null
  type: LessonType
  status: LessonStatus
}

/** Một chặng đã ghi trong workbook (dòng XUẤT PHÁT / SỐ KM / THÀNH TIỀN). */
export interface RecordedLeg {
  teacherId: string
  date: string
  session: Session
  period: number
  start: StartType
  km: number
  cost: number
  /** Trường đến của chặng; bản lưu cũ có thể chưa có. */
  toSchoolId?: string | null
}

export interface Week {
  id: string
  label: string
  startDate: string
  endDate: string
  status: 'archived' | 'planning'
  lessons: Lesson[]
  legs: RecordedLeg[]
  /** Cột CTP của workbook chỉ cộng từ ngày này (tuần vắt qua hai tháng). */
  reportedFrom?: string
  reported?: Record<string, { kns: number; stem: number; cds: number; cost: number }>
  /** Đã xoá (ISO time): ẩn khỏi mọi màn hình nhưng vẫn giữ nguyên để khôi phục. */
  deletedAt?: string
}

/** Tuần chưa bị xoá. */
export const isLiveWeek = (w: Pick<Week, 'deletedAt'>) => !w.deletedAt

export type Preference =
  | { id: string; type: 'finishBy'; time: string; days?: number[]; note?: string }
  | { id: string; type: 'startAfter'; time: string; days?: number[]; note?: string }
  | { id: string; type: 'noSession'; session: Session; days?: number[]; note?: string }

export interface Teacher {
  id: string
  name: string
  phone: string | null
  district: string | null
  address: string | null
  officeId: string
  isCollaborator: boolean
  isManager: boolean
  active: boolean
  track: string | null
  subjects: string[]
  gender: Gender | null
  maxKm: number | null
  /** Khu vực GV mong muốn đi dạy, viết hoa như cột KHU VỰC của data.xlsx. Rỗng = chưa khai báo. */
  areas: string[]
  onlineOnly: boolean
  /** Vị trí nhà: Plus Code, hoặc tâm phường/xã đọc từ địa chỉ. Chỉ có trong seed thật. */
  homeGeo?: GeoPoint
  homeArea?: string
  /** Thêm trên giao diện: được phép xoá khi chưa có ca nào. */
  isNew?: boolean
  preferences: Preference[]
}

export interface School {
  id: string
  fullName: string
  name: string | null
  region: string | null
  address: string | null
  consultant: string | null
  isExternal: boolean
  programs: { program: string; startDate: string | null; company: string | null; framework: string | null }[]
  referredTeacherIds: string[]
  /** derived = suy ra từ lịch sử dạy, confirmed = Gaia đã xác nhận. */
  referSource: 'derived' | 'confirmed'
  genderPreference?: Gender | null
  geo?: GeoPoint
  /** Thêm trên giao diện: được phép xoá khi chưa có ca nào. */
  isNew?: boolean
}

export interface Leave {
  id: string
  teacherId: string
  date: string
  session: Session
  kind: 'leave' | 'online'
  note: string
  /** Nghỉ theo ca: chỉ khoá đúng khung giờ của ca này, GV vẫn nhận được ca khác trong buổi. */
  lessonId?: string
  start?: string
  end?: string
  label?: string
}

export interface Office {
  id: string
  name: string
  address: string | null
  geo?: GeoPoint
}

export interface Distances {
  home: Record<string, number>
  office: Record<string, number>
  pair: Record<string, number>
}

export interface Tier {
  /** Áp dụng khi km < below. null = không giới hạn trên. */
  below: number | null
  amount: number
}

export interface Settings {
  costPolicy: 'tier' | 'perKm'
  tiersFromHome: Tier[]
  tiersFromOther: Tier[]
  ratePerKm: number
  longRouteKm: number
  longRouteAllowance: number
  travelSpeedKmh: number
  travelBufferMin: number
  weights: { distance: number; refer: number; preference: number; availability: number; subject: number }
}

export interface Seed {
  meta: { source: string; anonymized: boolean }
  offices: Office[]
  teachers: Teacher[]
  schools: School[]
  leaves: Leave[]
  weeks: Week[]
  distances: Distances
  places?: Place[]
}

export interface Place {
  name: string
  lat: number
  lng: number
}

export const DEFAULT_SETTINGS: Settings = {
  costPolicy: 'tier',
  // Trích nguyên từ công thức THÀNH TIỀN của workbook.
  tiersFromHome: [
    { below: 12, amount: 0 },
    { below: 18, amount: 30000 },
    { below: 24, amount: 40000 },
    { below: 30, amount: 60000 },
    { below: null, amount: 80000 },
  ],
  tiersFromOther: [
    { below: 7, amount: 0 },
    { below: 12, amount: 30000 },
    { below: 18, amount: 40000 },
    { below: 24, amount: 60000 },
    { below: 30, amount: 80000 },
    { below: null, amount: 110000 },
  ],
  // Tài liệu nêu công thức theo km nhưng chưa có đơn giá: các số dưới đây là giá trị tạm.
  ratePerKm: 3000,
  longRouteKm: 60,
  longRouteAllowance: 50000,
  travelSpeedKmh: 35,
  travelBufferMin: 5,
  weights: { distance: 25, refer: 25, preference: 15, availability: 20, subject: 15 },
}

/** Cách hiển thị giáo viên thống nhất: mã kèm tên. Bản ẩn danh có tên chứa sẵn mã nên không lặp lại. */
export const teacherLabel = (t: Pick<Teacher, 'id' | 'name'>) => (t.name.includes(t.id) ? t.name : `${t.id} · ${t.name}`)

export const TEACHING_CODES = new Set(['K', 'S', 'C', 'K/2', 'S/2', 'C/2'])

export const needsTeacher = (l: Lesson) =>
  l.status !== 'school_off' && l.status !== 'replaced' && l.status !== 'cancelled' && (l.code === null ? l.className !== null : TEACHING_CODES.has(l.code))

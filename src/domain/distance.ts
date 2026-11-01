import type { Distances, School, Teacher } from './types'

export type KmSource = 'recorded' | 'estimated' | 'manual'
export interface Km {
  km: number
  source: KmSource
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toUpperCase()

/**
 * Sổ khoảng cách suy từ SỐ KM mà Gaia đã ghi (workbook không có toạ độ hay địa chỉ trường).
 * Cặp nào chưa từng đi thì ước lượng bằng trung vị theo khu vực và gắn nhãn "estimated".
 */
export class DistanceBook {
  private districtRegion = new Map<string, number[]>()
  private officeRegion = new Map<string, number[]>()
  private regionPair = new Map<string, number[]>()
  private schools: Map<string, School>
  private teachers: Map<string, Teacher>
  private distances: Distances

  constructor(distances: Distances, teachers: Teacher[], schools: School[]) {
    this.distances = distances
    this.schools = new Map(schools.map((s) => [s.id, s]))
    this.teachers = new Map(teachers.map((t) => [t.id, t]))
    const push = (m: Map<string, number[]>, k: string, v: number) => m.set(k, [...(m.get(k) ?? []), v])
    for (const [k, v] of Object.entries(distances.home)) {
      const [t, s] = k.split('|')
      push(this.districtRegion, `${norm(this.teachers.get(t)?.district)}|${this.region(s)}`, v)
    }
    for (const [k, v] of Object.entries(distances.office)) {
      const [o, s] = k.split('|')
      push(this.officeRegion, `${o}|${this.region(s)}`, v)
    }
    for (const [k, v] of Object.entries(distances.pair)) {
      const [a, b] = k.split('|')
      push(this.regionPair, [this.region(a), this.region(b)].sort().join('|'), v)
    }
  }

  private region(schoolId: string) {
    return norm(this.schools.get(schoolId)?.region)
  }

  fromHome(teacherId: string, schoolId: string): Km {
    const exact = this.distances.home[`${teacherId}|${schoolId}`]
    if (exact !== undefined) return { km: exact, source: 'recorded' }
    const teacher = this.teachers.get(teacherId)
    const samples = this.districtRegion.get(`${norm(teacher?.district)}|${this.region(schoolId)}`)
    if (samples) return { km: median(samples), source: 'estimated' }
    return { km: this.fromOffice(teacher?.officeId ?? 'BR', schoolId).km, source: 'estimated' }
  }

  fromOffice(officeId: string, schoolId: string): Km {
    const exact = this.distances.office[`${officeId}|${schoolId}`]
    if (exact !== undefined) return { km: exact, source: 'recorded' }
    const samples = this.officeRegion.get(`${officeId}|${this.region(schoolId)}`)
    return { km: samples ? median(samples) : 20, source: 'estimated' }
  }

  between(a: string, b: string): Km {
    if (a === b) return { km: 0, source: 'recorded' }
    const exact = this.distances.pair[[a, b].sort().join('|')]
    if (exact !== undefined) return { km: exact, source: 'recorded' }
    const samples = this.regionPair.get([this.region(a), this.region(b)].sort().join('|'))
    return { km: samples ? median(samples) : 15, source: 'estimated' }
  }
}

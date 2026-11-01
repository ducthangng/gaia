import { isPrecise, roadKm } from './geo'
import type { Distances, GeoPoint, Office, School, Teacher } from './types'

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
 * Thứ tự ưu tiên: số đã ghi, rồi toạ độ thật, rồi trung vị theo khu vực (hai nguồn sau gắn nhãn "estimated").
 */
export class DistanceBook {
  private districtRegion = new Map<string, number[]>()
  private officeRegion = new Map<string, number[]>()
  private regionPair = new Map<string, number[]>()
  private schools: Map<string, School>
  private teachers: Map<string, Teacher>
  private distances: Distances
  private officeGeo: Map<string, GeoPoint | undefined>

  constructor(distances: Distances, teachers: Teacher[], schools: School[], offices: Office[] = []) {
    this.distances = distances
    this.officeGeo = new Map(offices.map((o) => [o.id, o.geo]))
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
    const school = this.schools.get(schoolId)?.geo
    // Vị trí nhà theo phường/xã vẫn sát hơn trung vị cả khu vực, nhưng vẫn chỉ là ước tính.
    if (teacher?.homeGeo && isPrecise(school)) return { km: roadKm(teacher.homeGeo, school), source: 'estimated' }
    const samples = this.districtRegion.get(`${norm(teacher?.district)}|${this.region(schoolId)}`)
    if (samples) return { km: median(samples), source: 'estimated' }
    return { km: this.fromOffice(teacher?.officeId ?? 'BR', schoolId).km, source: 'estimated' }
  }

  fromOffice(officeId: string, schoolId: string): Km {
    const exact = this.distances.office[`${officeId}|${schoolId}`]
    if (exact !== undefined) return { km: exact, source: 'recorded' }
    const a = this.officeGeo.get(officeId)
    const b = this.schools.get(schoolId)?.geo
    if (isPrecise(a) && isPrecise(b)) return { km: roadKm(a, b), source: 'estimated' }
    const samples = this.officeRegion.get(`${officeId}|${this.region(schoolId)}`)
    return { km: samples ? median(samples) : 20, source: 'estimated' }
  }

  between(a: string, b: string): Km {
    if (a === b) return { km: 0, source: 'recorded' }
    const exact = this.distances.pair[[a, b].sort().join('|')]
    if (exact !== undefined) return { km: exact, source: 'recorded' }
    const ga = this.schools.get(a)?.geo
    const gb = this.schools.get(b)?.geo
    if (isPrecise(ga) && isPrecise(gb)) return { km: roadKm(ga, gb), source: 'estimated' }
    const samples = this.regionPair.get([this.region(a), this.region(b)].sort().join('|'))
    return { km: samples ? median(samples) : 15, source: 'estimated' }
  }
}

import { DistanceBook } from './distance'
import type { RouteContext } from './route'
import type { Distances, Leave, Lesson, Office, School, Settings, Teacher, Week } from './types'

export interface World {
  teachers: Teacher[]
  schools: School[]
  offices: Office[]
  leaves: Leave[]
  distances: Distances
  settings: Settings
  kmOverrides: Record<string, number>
}

export interface WeekContext extends RouteContext {
  week: Week
  world: World
  teacherById: Map<string, Teacher>
  schoolById: Map<string, School>
  /** teacherId|date -> các ca của GV trong ngày */
  dayLessons: Map<string, Lesson[]>
}

export function buildContext(week: Week, world: World): WeekContext {
  const dayLessons = new Map<string, Lesson[]>()
  for (const l of week.lessons) {
    if (!l.teacherId) continue
    const k = `${l.teacherId}|${l.date}`
    const list = dayLessons.get(k)
    if (list) list.push(l)
    else dayLessons.set(k, [l])
  }
  const offices = new Map(world.offices.map((o) => [o.id, o.name]))
  return {
    week,
    world,
    book: new DistanceBook(world.distances, world.teachers, world.schools),
    settings: world.settings,
    kmOverrides: world.kmOverrides,
    officeName: (id) => offices.get(id) ?? 'Văn phòng',
    teacherById: new Map(world.teachers.map((t) => [t.id, t])),
    schoolById: new Map(world.schools.map((s) => [s.id, s])),
    dayLessons,
  }
}

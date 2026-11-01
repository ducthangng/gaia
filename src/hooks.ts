import { useMemo } from 'react'
import { buildContext } from './domain/context'
import { routeForWeek, type DayRoute } from './domain/route'
import { weekDates } from './domain/time'
import { useActiveWeek, useStore } from './store'

export function useWeekContext() {
  const week = useActiveWeek()
  const teachers = useStore((s) => s.teachers)
  const schools = useStore((s) => s.schools)
  const offices = useStore((s) => s.offices)
  const leaves = useStore((s) => s.leaves)
  const distances = useStore((s) => s.distances)
  const settings = useStore((s) => s.settings)
  const kmOverrides = useStore((s) => s.kmOverrides)
  return useMemo(
    () => buildContext(week, { teachers, schools, offices, leaves, distances, settings, kmOverrides }),
    [week, teachers, schools, offices, leaves, distances, settings, kmOverrides],
  )
}

export type Ctx = ReturnType<typeof useWeekContext>

export interface WeekCost {
  teacherId: string
  days: DayRoute[]
  km: number
  cost: number
  hasEstimate: boolean
}

export function weekCosts(ctx: Ctx): WeekCost[] {
  const dates = weekDates(ctx.week.startDate)
  return ctx.world.teachers
    .filter((t) => t.active || ctx.week.lessons.some((l) => l.teacherId === t.id) || ctx.week.legs.some((x) => x.teacherId === t.id))
    .map((t) => {
      const days = dates.map((d) => routeForWeek(ctx.week, t, d, ctx))
      return {
        teacherId: t.id,
        days,
        km: days.reduce((s, d) => s + d.totalKm, 0),
        cost: days.reduce((s, d) => s + d.cost, 0),
        hasEstimate: days.some((d) => d.hasEstimate),
      }
    })
}

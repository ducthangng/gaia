import { create } from 'zustand'
import { toast } from '../components/ui'
import { useStore } from '../store'
import { api, ApiError, type ApiUser, type Entity } from './api'
import { applyEntities, diffIndex, emptyState, entityKey, indexState, recordSynced, type EntityIndex, type SyncedState } from './entities'

type Phase = 'saved' | 'saving' | 'offline' | 'error'

interface SyncStatus {
  phase: Phase
  pending: number
  message: string | null
  lastSaved: Date | null
  /** null khi phiên hết hạn: hiện lại màn đăng nhập, thay đổi chưa gửi vẫn giữ trong bộ nhớ. */
  user: ApiUser | null
}

export const useSync = create<SyncStatus>(() => ({ phase: 'saved', pending: 0, message: null, lastSaved: null, user: null }))

const PUSH_DELAY = 700
const PULL_EVERY = 15_000
const LABELS: Record<string, string> = { lesson: 'ca', teacher: 'giáo viên', school: 'trường', leave: 'lịch nghỉ', week: 'tuần', distance: 'số km', kmOverride: 'km sửa tay', settings: 'cấu hình', office: 'văn phòng' }

let base: EntityIndex = new Map()
let rev = 0
let running = false
let again = false
let timer: ReturnType<typeof setTimeout> | undefined
let started = false

const synced = (): SyncedState => useStore.getState()

/** Nạp toàn bộ dữ liệu từ server vào store. Trả về số tuần có trong dữ liệu. */
export async function hydrate(user: ApiUser) {
  const snap = await api<{ rev: number; entities: Entity[] }>('/state')
  const state = applyEntities(emptyState(), snap.entities)
  const wanted = useStore.getState().activeWeekId
  const activeWeekId = state.weeks.some((w) => w.id === wanted) ? wanted : state.weeks.at(-1)?.id ?? ''
  useStore.setState({ ...state, activeWeekId, lastEdit: null, beforeReset: null })
  base = indexState(state)
  rev = snap.rev
  useSync.setState({ user, phase: 'saved', pending: 0, message: null })
  start()
  return state.weeks.length
}

function start() {
  if (started) return
  started = true
  useStore.subscribe((s, prev) => {
    if (s.teachers !== prev.teachers || s.schools !== prev.schools || s.offices !== prev.offices || s.leaves !== prev.leaves || s.weeks !== prev.weeks || s.distances !== prev.distances || s.kmOverrides !== prev.kmOverrides || s.settings !== prev.settings) {
      schedule(PUSH_DELAY)
    }
  })
  setInterval(() => document.visibilityState === 'visible' && schedule(0), PULL_EVERY)
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && schedule(0))
  window.addEventListener('online', () => schedule(0))
  window.addEventListener('beforeunload', (e) => {
    if (running || diffIndex(base, indexState(synced())).length) e.preventDefault()
  })
}

export function schedule(ms: number) {
  clearTimeout(timer)
  timer = setTimeout(tick, ms)
}

const summarize = (changes: Entity[]) => {
  const n = new Map<string, number>()
  for (const c of changes) n.set(c.c, (n.get(c.c) ?? 0) + 1)
  return [...n].map(([c, k]) => `${k} ${LABELS[c] ?? c}`).join(', ')
}

async function tick() {
  if (running) {
    again = true
    return
  }
  if (!useSync.getState().user) return
  running = true
  again = false
  try {
    const now = indexState(synced())
    const changes = diffIndex(base, now)
    if (changes.length) {
      useSync.setState({ phase: 'saving', pending: changes.length })
      try {
        await api('/changes', { body: { baseRev: rev, changes, summary: summarize(changes) } })
        for (const ch of changes) {
          const key = entityKey(ch.c, ch.id)
          if (ch.data === null) base.delete(key)
          else base.set(key, now.get(key))
        }
      } catch (e) {
        if (!(e instanceof ApiError) || e.status !== 409) throw e
        // Người khác vừa sửa đúng các bản ghi này: lấy bản của họ, phần còn lại gửi lại ở lượt sau.
        const conflicts = (e.body as { conflicts: Entity[] }).conflicts
        apply(conflicts, new Set())
        toast(`${conflicts.length} bản ghi vừa được người khác sửa trước. Đã lấy bản mới nhất, hãy kiểm tra lại.`)
        again = true
      }
    }
    await pull()
    const left = diffIndex(base, indexState(synced())).length
    useSync.setState({ phase: left ? 'saving' : 'saved', pending: left, message: null, lastSaved: changes.length ? new Date() : useSync.getState().lastSaved })
    if (left) again = true
  } catch (e) {
    const err = e instanceof ApiError ? e : new ApiError(-1, String(e))
    if (err.status === 401) {
      useSync.setState({ user: null, phase: 'offline', message: 'Phiên đăng nhập đã hết hạn' })
    } else {
      useSync.setState({ phase: err.status === 0 ? 'offline' : 'error', message: err.message, pending: diffIndex(base, indexState(synced())).length })
      schedule(err.status === 0 ? 5_000 : 30_000)
    }
  } finally {
    running = false
    if (again) schedule(PUSH_DELAY)
  }
}

async function pull() {
  const delta = await api<{ rev: number; entities: Entity[] }>(`/state?since=${rev}`)
  if (delta.entities.length) {
    // Bản ghi đang sửa dở ở máy này (khác bản đã đồng bộ) thì giữ bản ở máy và gửi lên sau.
    const now = indexState(synced())
    const dirty = new Set(diffIndex(base, now).map((c) => entityKey(c.c, c.id)))
    apply(delta.entities, dirty)
  }
  rev = delta.rev
}

function apply(entities: Entity[], keep: Set<string>) {
  const s = useStore.getState()
  const next = applyEntities(s, entities, keep)
  const patch: Partial<SyncedState> = {}
  for (const k of Object.keys(next) as (keyof SyncedState)[]) if (next[k] !== s[k]) (patch as Record<string, unknown>)[k] = next[k]
  recordSynced(base, entities)
  if (Object.keys(patch).length) {
    if (patch.weeks && !patch.weeks.some((w) => w.id === s.activeWeekId) && patch.weeks.length) (patch as Record<string, unknown>).activeWeekId = patch.weeks.at(-1)!.id
    useStore.setState(patch)
  }
}

/** Gửi ngay những gì còn chờ (dùng trước khi đăng xuất). */
export async function flush() {
  clearTimeout(timer)
  await tick()
}

export const hasPending = () => diffIndex(base, indexState(synced())).length > 0

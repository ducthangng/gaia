import type { Seed } from '../domain/types'
import publicSeed from './seed.json'

// seed.local.json chứa SĐT và địa chỉ nhà thật: chỉ nạp khi chạy dev trên máy điều phối.
// Bản build dùng seed.json: có tên giáo viên, không có SĐT, địa chỉ nhà, vị trí nhà.
const local = import.meta.env.DEV ? import.meta.glob('./seed.local.json', { eager: true, import: 'default' }) : {}

export const seed = (Object.values(local)[0] ?? publicSeed) as unknown as Seed

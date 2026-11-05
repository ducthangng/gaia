import type { Place } from '../domain/types'
import placesJson from './places.json'

/**
 * Dữ liệu lịch lấy từ server (xem src/sync). Frontend chỉ đóng gói tâm phường/xã: thông tin công khai,
 * dùng để định vị khi người dùng sửa địa chỉ. scripts/extract_workbook.py tạo lại file này.
 */
export const places = placesJson as Place[]

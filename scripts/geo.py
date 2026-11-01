"""Tiện ích toạ độ dùng chung: giải Plus Code ngay trên máy và tính khoảng cách."""
import math
import re

OLC = "23456789CFGHJMPQRVWX"
PLUS_CODE = re.compile(r"\b([23456789CFGHJMPQRVWX]{4})\+([23456789CFGHJMPQRVWX]{2,3})\b")
# Tâm Bà Rịa - Vũng Tàu: mọi Plus Code rút gọn trong vùng nằm trong phạm vi 0,5 độ quanh điểm này.
REFERENCE = (10.5, 107.25)


def decode_short_plus_code(text, ref=REFERENCE):
    """Giải Plus Code rút gọn (4+3 ký tự) quanh điểm tham chiếu. Trả về (lat, lng) hoặc None."""
    m = PLUS_CODE.search(text or "")
    if not m:
        return None
    head, tail = m[1], m[2]
    lat, lng = 0.0, 0.0
    # Hai cặp ký tự đầu bị rút gọn: lấy từ điểm tham chiếu (độ phân giải 1 độ).
    lat += math.floor(ref[0] + 90)
    lng += math.floor(ref[1] + 180)
    res = 0.05
    lat += OLC.index(head[0]) * res
    lng += OLC.index(head[1]) * res
    res = 0.0025
    lat += OLC.index(head[2]) * res
    lng += OLC.index(head[3]) * res
    res = 0.000125
    lat += OLC.index(tail[0]) * res
    lng += OLC.index(tail[1]) * res
    size_lat, size_lng = res, res
    if len(tail) == 3:
        i = OLC.index(tail[2])
        size_lat, size_lng = res / 5, res / 4
        lat += (i // 4) * size_lat
        lng += (i % 4) * size_lng
    lat, lng = lat + size_lat / 2 - 90, lng + size_lng / 2 - 180
    if lat <= ref[0] - 0.5:
        lat += 1
    elif lat > ref[0] + 0.5:
        lat -= 1
    if lng <= ref[1] - 0.5:
        lng += 1
    elif lng > ref[1] + 0.5:
        lng -= 1
    return round(lat, 6), round(lng, 6)


def haversine(a, b):
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dl = math.radians(b[1] - a[1])
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))

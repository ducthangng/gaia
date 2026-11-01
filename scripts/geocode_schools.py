#!/usr/bin/env python3
"""Tra toạ độ các địa chỉ trường/văn phòng dạng chữ qua Nominatim (OpenStreetMap).

Địa chỉ có Plus Code được giải ngay trên máy, không qua script này. Chỉ gửi địa chỉ trường và
văn phòng; TUYỆT ĐỐI không gửi địa chỉ nhà giáo viên. Kết quả ghi vào scripts/street-geocache.json
để extract_workbook.py dùng lại.

    python scripts/geocode_schools.py data.xlsx
"""
import json
import re
import sys
import time
import urllib.parse
import urllib.request

import openpyxl

sys.path.insert(0, "scripts")
from geo import decode_short_plus_code  # noqa: E402

UA = {"User-Agent": "gaia-scheduling-geocoder/0.1 (one-off school address lookup)"}
VIEWBOX = "106.95,10.85,107.75,10.30"


def search(q):
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
        {"q": q, "format": "jsonv2", "limit": 1, "viewbox": VIEWBOX, "bounded": 1, "countrycodes": "vn"})
    time.sleep(1.1)
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
        res = json.load(r)
    return res[0] if res else None


def variants(addr):
    """Địa chỉ trong file ghi theo đơn vị hành chính mới; OSM khớp tốt hơn khi bỏ bớt dần."""
    a = re.sub(r"\(.*?\)", "", addr)
    a = re.sub(r",?\s*(Thành phố )?(Hồ Chí Minh|Ho Chi Minh)(, Vi[eệ]tnam| Việt Nam)?\.?$", "", a.strip()).strip(" ,.")
    a = re.sub(r",?\s*Vietnam$", "", a).strip(" ,")
    a = re.sub(r"\bĐ\.\s*", "Đường ", a)
    a = re.sub(r"^Trường [^,]+,\s*", "", a)
    no_number = re.sub(r"^(Số\s*)?\d+\w*(/\d+)*\s*,?\s*(Đường\s*)?", "", a)
    return list(dict.fromkeys([a, no_number, no_number.split(",")[0]]))


def main():
    wb = openpyxl.load_workbook(sys.argv[1], data_only=True)
    addrs = [re.sub(r"\s+", " ", str(r[7])).strip() for r in wb["Sheet1"].iter_rows(min_row=2, values_only=True) if r[2] and r[7]]
    addrs.append("65 Bùi Xuân Phái, Phường Bà Rịa")
    cache = {}
    for addr in addrs:
        if decode_short_plus_code(addr):
            continue
        for q in variants(addr):
            hit = search(q)
            if hit:
                cache[addr] = {"lat": float(hit["lat"]), "lng": float(hit["lon"]), "level": hit.get("addresstype"), "match": hit["display_name"][:90]}
                break
        print(("OK  " if addr in cache else "NONE"), addr[:55].ljust(56), "->", cache.get(addr, {}).get("match", "")[:80])
    json.dump(cache, open("scripts/street-geocache.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)


main()

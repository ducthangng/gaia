#!/usr/bin/env python3
"""Tra toạ độ các phường/xã trong danh sách cố định và ghi scripts/place-geocache.json.

Chỉ gửi TÊN PHƯỜNG/XÃ công khai trong PLACES dưới đây, không đọc file địa chỉ nên không thể
làm lộ số nhà hay tên đường của giáo viên.

    python3 scripts/geocode_places.py
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from places import PLACES  # noqa: E402

UA = {"User-Agent": "gaia-scheduling-geocoder/0.1 (public ward names only)"}
VIEWBOX = "106.90,10.90,107.75,10.30"


def search(q):
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
        {"q": q, "format": "jsonv2", "limit": 1, "viewbox": VIEWBOX, "bounded": 1, "countrycodes": "vn"})
    time.sleep(1.1)
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
        res = json.load(r)
    return res[0] if res else None


out = {}
# Tên trùng với nơi khác trong vùng nên phải ghi rõ tỉnh.
EXACT_QUERY = {"Phước Thái": "Xã Phước Thái, Đồng Nai"}
for name in PLACES:
    hit = None
    for prefix in ("Phường ", "Xã ", ""):
        hit = search(EXACT_QUERY.get(name, f"{prefix}{name}"))
        if hit and hit.get("addresstype") in ("suburb", "village", "town", "city", "municipality", "quarter", "city_district", "hamlet", "neighbourhood", "administrative"):
            break
        hit = None
    if hit:
        out[name] = {"lat": float(hit["lat"]), "lng": float(hit["lon"]), "match": hit["display_name"][:70]}
    print(("OK  " if hit else "NONE"), name.ljust(14), out.get(name, {}).get("match", ""))
json.dump(out, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "place-geocache.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)

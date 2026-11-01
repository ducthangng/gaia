#!/usr/bin/env python3
"""Chuyển workbook lịch (LỊCH VŨNG TÀU) thành seed JSON cho frontend.

    python scripts/extract_workbook.py <file.xlsx> src/data/seed.local.json
    python scripts/extract_workbook.py <file.xlsx> src/data/seed.json --anonymize

seed.local.json chứa dữ liệu cá nhân thật (SĐT, địa chỉ nhà) và không được commit/deploy.
seed.json là bản đã ẩn danh, dùng cho bản build/demo.
"""
import argparse
import collections
import datetime as dt
import json
import re
import statistics
import unicodedata

import openpyxl
from openpyxl.utils import column_index_from_string

FILL_STATUS = {
    "FF000000": "sub", "FF980000": "sub", "FF4A86E8": "sub",
    "FF8E7CC3": "makeup", "FFF6B26B": "makeup", "FF3D85C6": "makeup",
    "FFF6A4F6": "support", "FF0000FF": "support",
    "FFFF0000": "leave",
    "FF00FF00": "event",
    "FF999999": "school_off",
    "FFCC4125": "observe",
}
TEACHING_CODES = {"K", "S", "C", "K/2", "S/2", "C/2"}
EVENT_CODES = {"BCTH", "BCTH/2", "BCCĐ", "ĐP", "HN", "KI", "BN", "HT", "TQ", "CA", "NB"}
OFFICES = {"VP. Bà Rịa": "BR", "VP Bà Rịa": "BR", "VP. Phú Mỹ": "PM", "VP Phú Mỹ": "PM"}
# Viết khác nhau trong workbook nhưng là cùng một trường.
SCHOOL_ALIASES = {
    "TH Bình Ba": "TH Bình Ba - Bà Rịa",
    "TH HỒ TRÀM - XUYÊN MỘC": "TH Hồ Tràm - Xuyên Mộc",
    "TH Hồ Tràm - XUYÊN MỘC": "TH Hồ Tràm - Xuyên Mộc",
    "TH HUỲNH MINH THẠNH - Hồ Tràm": "TH Huỳnh Minh Thạnh - Hồ Tràm",
    "TH PHƯỚC BỬU - Hồ Tràm": "TH Phước Bửu - Hồ Tràm",
    "TH Phước Bửu - VT": "TH Phước Bửu - Hồ Tràm",
    "Tiểu học Phước Hưng – Long Điền": "TH Phước Hưng - Long Điền",
    "TH Phước Hải  - Phước Hải": "TH Phước Hải - Phước Hải",
}


def clean(v):
    if v is None:
        return None
    if isinstance(v, float) and v == int(v):
        v = int(v)
    s = re.sub(r"\s+", " ", str(v)).strip()
    return s or None


def school_name(raw):
    raw = clean(raw)
    return SCHOOL_ALIASES.get(raw, raw) if raw else None


def slug(s):
    s = unicodedata.normalize("NFD", s.replace("Đ", "D").replace("đ", "d"))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def fmt_time(v):
    m = re.match(r"^(\d{1,2})\s*[hH:]\s*(\d{0,2})$", clean(v) or "")
    return f"{int(m[1]):02d}:{int(m[2] or 0):02d}" if m else None


def fill_of(cell):
    rgb = cell.fill.fgColor.rgb
    return FILL_STATUS.get(rgb) if isinstance(rgb, str) else None


def classify(fill, code):
    if fill in ("sub", "makeup", "support", "event", "observe"):
        return {"sub": "substitute"}.get(fill, fill)
    if code == "CM":
        return "support"
    if code in EVENT_CODES:
        return "event"
    return "regular"


def parse_week(ws, teachers, leaves_out):
    days = [(c.column, c.value.strftime("%Y-%m-%d")) for c in ws[1] if isinstance(c.value, dt.datetime)]
    lessons, legs, reported = [], [], {}
    # Vị trí cột tổng khác nhau giữa các sheet nên tra theo tiêu đề dòng 1.
    totals = {clean(c.value): c.column for c in ws[1] if clean(c.value) in ("TTKNS", "TTSTEM", "TTCDS", "CTP")}
    i = 4
    while ws.cell(i, 5).value == "TRƯỜNG":
        code = clean(ws.cell(i, 1).value)
        if code and clean(ws.cell(i, 2).value):
            office = clean(ws.cell(i + 1, 4).value)
            phone = clean(ws.cell(i + 1, 2).value)
            teachers.setdefault(code, {
                "id": code,
                "name": clean(ws.cell(i, 2).value),
                "phone": phone if phone and re.fullmatch(r"[\d .]+", phone) else None,
                "district": (clean(ws.cell(i, 3).value) or "").upper() or None,
                "address": clean(ws.cell(i, 4).value),
                "officeId": OFFICES.get(office, "BR"),
                "isCollaborator": code.startswith("CTV"),
                "isManager": clean(ws.cell(i + 2, 2).value) == "QUẢN LÝ",
                "active": False,
            })
            rows = collections.defaultdict(list)
            for j in range(i, i + 22):
                label = clean(ws.cell(j, 5).value)
                if label:
                    rows[label].append(j)
            for track, row in enumerate(rows["TRƯỜNG"]):
                val = lambda label, c: clean(ws.cell(rows[label][track], c).value)
                for col, date in days:
                    for c in range(col, col + 12):
                        school = school_name(ws.cell(row, c).value)
                        code_qd, note = val("QĐ. TRƯỜNG", c), val("GHI CHÚ", c)
                        fill = fill_of(ws.cell(row, c))
                        session = "AM" if c - col < 6 else "PM"
                        period = (c - col) % 6 + 1
                        cls, subject = val("LỚP", c), val("MÔN", c)
                        blob = " ".join(filter(None, [note, code_qd])).lower()
                        if "online" in blob:
                            leaves_out.append({"teacherId": code, "date": date, "session": session, "kind": "online", "note": "Làm việc online"})
                            continue
                        if fill == "leave" or code_qd == "NP" or (note or "").upper().startswith("NP"):
                            leaves_out.append({"teacherId": code, "date": date, "session": session, "kind": "leave", "note": note if note and len(note) < 30 else "Nghỉ phép"})
                        if not school:
                            continue  # Chỉ có khung giờ mẫu, không có ca thực.
                        is_code = code_qd if code_qd and len(code_qd) <= 6 else None
                        lessons.append({
                            "teacherId": code, "date": date, "session": session, "period": period, "track": track,
                            "school": school, "className": cls, "subject": subject,
                            "start": fmt_time(val("BẮT ĐẦU", c)), "end": fmt_time(val("KẾT THÚC", c)),
                            "code": is_code, "company": val("CÔNG TY", c),
                            "note": note or (code_qd if not is_code else None),
                            "type": classify(fill, is_code), "fill": fill,
                        })
            start_row = rows["XUẤT PHÁT"][0]
            for col, date in days:
                for c in range(col, col + 12):
                    start, km, cost = clean(ws.cell(start_row, c).value), ws.cell(start_row + 1, c).value, ws.cell(start_row + 2, c).value
                    if start in ("N", "V", "K") and isinstance(km, (int, float)):
                        legs.append({"teacherId": code, "date": date, "session": "AM" if c - col < 6 else "PM",
                                     "period": (c - col) % 6 + 1, "start": start, "km": km,
                                     "cost": cost if isinstance(cost, (int, float)) else 0})
            total_row = rows["TIẾT KNS"][0]
            cell = lambda name: ws.cell(total_row, totals[name]).value or 0
            reported[code] = {"kns": cell("TTKNS"), "stem": cell("TTSTEM"), "cds": cell("TTCDS"), "cost": cell("CTP")}
        i += 22
    return days, lessons, legs, reported


def resolve_leave_lessons(lessons):
    """Ca của GV nghỉ phép: có người khác dạy cùng lớp/giờ => đã thay; ngược lại => cần cover."""
    key = lambda l: (l["date"], l["school"], l["className"], l["start"])
    others = collections.defaultdict(list)
    for l in lessons:
        if l["fill"] != "leave":
            others[key(l)].append(l)
    for l in lessons:
        if l["fill"] == "school_off":
            l["status"] = "school_off"
        elif l["fill"] == "leave":
            replacement = [o for o in others.get(key(l), []) if o["teacherId"] != l["teacherId"] and o["fill"] != "school_off"]
            l["originalTeacherId"] = l["teacherId"]
            if replacement:
                l["status"] = "replaced"
                for o in replacement:
                    o["originalTeacherId"] = l["teacherId"]
                    o["type"] = "substitute"
            else:
                l["status"] = "needs_cover"
                l["teacherId"] = None
        else:
            l["status"] = "assigned"


def build_distances(weeks, teachers, schools_by_name):
    home, office, pair = [collections.defaultdict(list) for _ in range(3)]
    for w in weeks:
        by_day = collections.defaultdict(list)
        for l in w["lessons"]:
            by_day[(l["originalTeacherId"] if l["status"] != "assigned" and l.get("originalTeacherId") else l["teacherId"], l["date"])].append(l)
        for leg in w["legs"]:
            day = sorted(by_day.get((leg["teacherId"], leg["date"]), []), key=lambda l: (l["session"], l["period"], l["track"]))
            pos = (leg["session"], leg["period"])
            here = [l for l in day if (l["session"], l["period"]) == pos]
            if not here:
                continue
            to = here[0]["schoolId"]
            if leg["start"] == "N":
                home[f'{leg["teacherId"]}|{to}'].append(leg["km"])
            elif leg["start"] == "V":
                office[f'{teachers[leg["teacherId"]]["officeId"]}|{to}'].append(leg["km"])
            else:
                prev = [l for l in day if (l["session"], l["period"]) < pos and l["schoolId"] != to]
                if prev:
                    pair["|".join(sorted((prev[-1]["schoolId"], to)))].append(leg["km"])
    med = lambda d: {k: statistics.median(v) for k, v in d.items()}
    return {"home": med(home), "office": med(office), "pair": med(pair)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("workbook")
    ap.add_argument("out")
    ap.add_argument("--anonymize", action="store_true")
    args = ap.parse_args()
    wb = openpyxl.load_workbook(args.workbook, data_only=True)
    formulas = openpyxl.load_workbook(args.workbook)

    teachers, weeks, leaves = {}, [], []
    for ws in wb.worksheets:  # Sheet mới nhất đứng trước, nên thông tin GV lấy theo tuần mới nhất.
        if not re.match(r"Thang \d+ - Tuan \d+", ws.title):
            continue
        days, lessons, legs, reported = parse_week(ws, teachers, leaves)
        resolve_leave_lessons(lessons)
        # Tuần vắt qua hai tháng: cột CTP chỉ cộng từ ngày đầu tháng mới, ví dụ =SUM($AP25:$CK25).
        ctp_col = next(c.column for c in ws[1] if clean(c.value) == "CTP")
        match = re.match(r"=SUM\(\$?([A-Z]+)", str(formulas[ws.title].cell(20, ctp_col).value))
        first_col = column_index_from_string(match[1]) if match else days[0][0]
        reported_from = next((d for col, d in days if col <= first_col < col + 12), days[0][1])
        weeks.append({"id": days[0][1], "reportedFrom": reported_from, "label": ws.title.replace("Thang", "Tháng").replace("Tuan", "Tuần"),
                      "startDate": days[0][1], "endDate": days[-1][1], "status": "archived",
                      "lessons": lessons, "legs": legs, "reported": reported})
    weeks.sort(key=lambda w: w["startDate"])
    weeks[-1]["status"] = "planning"
    for code in weeks[-1]["reported"]:
        teachers[code]["active"] = True

    # Hồ sơ năng lực GV (TÍCH HỢP / STEM-CDS-AI) nằm ở sheet TT_CTP.
    tt = wb["TT_CTP"]
    for r in range(4, tt.max_row + 1):
        code, track = clean(tt.cell(r, 1).value), clean(tt.cell(r, 6).value)
        if code in teachers and track:
            teachers[code]["track"] = track

    # Trường
    ds = wb["Danh Sách Trường"]
    groups = [(7, "KNS"), (10, "STEM"), (13, "STEM-AI"), (16, "STEM AI - ROBOTICS"), (19, "CDS"), (22, "AI")]
    schools = {}
    for r in range(3, 37):
        full = school_name(ds.cell(r, 5).value)
        if not full or full.strip(" -") == "":
            continue
        s = schools.setdefault(full, {
            "id": slug(full), "fullName": full, "name": clean(ds.cell(r, 3).value), "region": clean(ds.cell(r, 4).value),
            "address": None, "consultant": clean(ds.cell(r, 6).value), "programs": [], "isExternal": False,
            "referredTeacherIds": [], "referSource": "derived",
        })
        for col, program in groups:
            start, company, framework = ds.cell(r, col).value, clean(ds.cell(r, col + 1).value), clean(ds.cell(r, col + 2).value)
            if start or framework:
                s["programs"].append({"program": program, "startDate": start.strftime("%Y-%m-%d") if isinstance(start, dt.datetime) else None,
                                      "company": company, "framework": framework})
    for w in weeks:
        for l in w["lessons"]:
            name = l["school"]
            if name not in schools:
                parts = [p.strip() for p in re.split(r"\s[-–]\s", name, maxsplit=1)]
                schools[name] = {"id": slug(name), "fullName": name, "name": parts[0], "region": parts[1] if len(parts) > 1 else None,
                                 "address": None, "consultant": None, "programs": [], "referredTeacherIds": [],
                                 "isExternal": sum(1 for x in w["lessons"] if x["school"] == name) < 6 and len(parts) == 1,
                                 "referSource": "derived"}
            l["schoolId"] = schools[name]["id"]

    # Workbook không có danh sách Refer: tạm suy ra từ GV dạy chính ổn định tại trường.
    # Đánh dấu referSource="derived" để giao diện yêu cầu Gaia xác nhận.
    counts = collections.Counter()
    for w in weeks:
        for l in w["lessons"]:
            if l["type"] == "regular" and l["code"] in TEACHING_CODES and l["teacherId"]:
                counts[(l["school"], l["teacherId"])] += 1
    for (school, teacher), n in counts.items():
        if n >= 6:
            schools[school]["referredTeacherIds"].append(teacher)

    # Năng lực môn: suy từ lịch sử dạy thực tế.
    taught = collections.defaultdict(collections.Counter)
    for w in weeks:
        for l in w["lessons"]:
            if l["subject"] and l["teacherId"] and l["code"] in TEACHING_CODES:
                taught[l["teacherId"]][l["subject"]] += 1
    for t in teachers.values():
        t["subjects"] = sorted(taught[t["id"]])
        t.setdefault("track", None)
        t.update(gender=None, maxKm=None, preferences=[])

    distances = build_distances(weeks, teachers, schools)

    # Gộp leave theo (GV, ngày, buổi), bỏ trùng.
    seen, leave_list = set(), []
    for lv in leaves:
        k = (lv["teacherId"], lv["date"], lv["session"])
        if k not in seen:
            seen.add(k)
            leave_list.append({"id": f"lv-{len(leave_list)}", **lv})

    next_id = 0
    for w in weeks:
        for l in w["lessons"]:
            next_id += 1
            l["id"] = f"l{next_id}"
            l["weekId"] = w["id"]
            del l["school"], l["fill"]
            l.setdefault("originalTeacherId", None)

    out = {"meta": {"source": "LỊCH VŨNG TÀU NH 2026-2027", "anonymized": args.anonymize},
           "offices": [{"id": "BR", "name": "VP Bà Rịa", "address": None}, {"id": "PM", "name": "VP Phú Mỹ", "address": None}],
           "teachers": sorted(teachers.values(), key=lambda t: t["id"]), "schools": sorted(schools.values(), key=lambda s: s["fullName"]),
           "leaves": leave_list, "weeks": weeks, "distances": distances}

    if args.anonymize:
        for t in out["teachers"]:
            t.update(name=f"Giáo viên {t['id']}", phone=None, address=None)
        for s in out["schools"]:
            s["consultant"] = None
        for lv in out["leaves"]:
            lv["note"] = "Làm việc online" if lv["kind"] == "online" else "Nghỉ phép"
        for w in out["weeks"]:
            for l in w["lessons"]:
                if l["note"] not in ("CS1", "CS2"):
                    l["note"] = None

    json.dump(out, open(args.out, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    n = sum(len(w["lessons"]) for w in weeks)
    print(f"{args.out}: {len(out['teachers'])} GV, {len(out['schools'])} trường, {len(weeks)} tuần, {n} ca, {len(leave_list)} nghỉ")
    for w in weeks:
        print(" ", w["label"], w["status"], len(w["lessons"]), collections.Counter(l["status"] for l in w["lessons"]))
    print("  Refer:", sum(len(s["referredTeacherIds"]) for s in out["schools"]), "| km:", {k: len(v) for k, v in distances.items()})


main()

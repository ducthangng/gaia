"""Danh sách phường/xã nơi giáo viên ở, và cách nhận ra chúng trong địa chỉ (chạy hoàn toàn trên máy)."""
import unicodedata

# Tên cụ thể đứng trước tên rộng: "Long Hương, Bà Rịa" phải ra Long Hương.
PLACES = ["Rạch Dừa", "Phước Thắng", "Tam Thắng", "Long Hương", "Long Toàn", "Tam Long", "Long Điền", "Long Hải",
          "Đất Đỏ", "Ngãi Giao", "Nghĩa Thành", "Tân Hải", "Tân Thành", "Phước Thái", "Phú Mỹ", "Bà Rịa", "Vũng Tàu"]
# Lỗi gõ đã gặp trong dữ liệu.
TYPOS = {"rach rua": "rach dua"}


def fold(s):
    s = unicodedata.normalize("NFD", s.replace("Đ", "D").replace("đ", "d"))
    return "".join(c for c in s if unicodedata.category(c) != "Mn").lower()


def place_in_address(address):
    text = fold(address or "")
    for wrong, right in TYPOS.items():
        text = text.replace(wrong, right)
    return next((p for p in PLACES if fold(p) in text), None)

# Gaia – Hệ thống điều phối lịch dạy (giai đoạn Frontend)

```bash
npm install
npm run dev     # dùng dữ liệu thật nếu có src/data/seed.local.json
npm test
npm run build   # luôn dùng seed đã ẩn danh
```

## Dữ liệu

`scripts/extract_workbook.py` chuyển workbook lịch và `data.xlsx` (địa chỉ trường, km từ văn phòng, địa chỉ và khu vực giáo viên) thành seed JSON. Cần `openpyxl`:

```bash
python3 scripts/geocode_schools.py data.xlsx   # chỉ khi địa chỉ trường dạng chữ thay đổi
python3 scripts/extract_workbook.py "<lịch>.xlsx" src/data/seed.local.json --data data.xlsx
python3 scripts/extract_workbook.py "<lịch>.xlsx" src/data/seed.json --data data.xlsx --anonymize
```

- `seed.local.json`: có SĐT và địa chỉ nhà của giáo viên. Chỉ nạp khi chạy `dev`, không commit, không deploy.
- `seed.json`: đã ẩn danh. Là dữ liệu của mọi bản build, an toàn cho Vercel.

Chỉnh sửa trên giao diện được lưu ở `localStorage` của trình duyệt cho tới khi có backend.

### Toạ độ và bản đồ

- Plus Code được giải ngay trên máy (`scripts/geo.py`), không gọi dịch vụ ngoài.
- Địa chỉ trường dạng chữ tra qua Nominatim (OpenStreetMap). Địa chỉ nhà giáo viên không bao giờ được gửi tự động.
- Vị trí nhà giáo viên: Plus Code nếu có, không thì tâm phường/xã đọc từ địa chỉ ngay trên máy (`scripts/places.py`). `scripts/geocode_places.py` chỉ tra các tên phường trong danh sách cố định. Chặng từ nhà vẽ bằng đường thẳng và không gửi cho máy chủ tìm đường; link Google Maps chỉ gửi địa chỉ khi người dùng bấm.
- Điểm tra được bị loại nếu đường chim bay dài hơn số km đã ghi; trường chưa có vị trí tin cậy đặt ở tâm khu vực và ghi rõ "gần đúng".
- Bản đồ dùng Leaflet với tile OpenStreetMap, đường đi lấy từ máy chủ demo của OSRM, cả hai đều không cần API key. Khi dùng thật nhiều nên chuyển sang nhà cung cấp có cam kết dịch vụ.
- Link "Chỉ đường Google Maps" không cần API key. Nhúng hẳn Google Maps vào trang thì cần API key và tài khoản thanh toán.

## Quy tắc tính lấy từ workbook

| Chủ đề | Quy tắc | Nguồn |
|---|---|---|
| Điểm xuất phát | Có ca sáng: Nhà (N). Chỉ có ca chiều: Văn phòng của GV (V). Đổi trường: Khác (K) | Dòng XUẤT PHÁT |
| Chi phí | Mỗi chặng một mức theo bậc km, N và V/K có biểu riêng. Chặng về nhà không tính tiền | Công thức THÀNH TIỀN |
| Đối soát | Tuần vắt qua hai tháng: CTP chỉ cộng từ ngày đầu tháng mới | Công thức cột CTP |

Công thức km × đơn giá trong tài liệu dự án vẫn có sẵn ở Cấu hình, với đơn giá tạm.

## Cấu trúc

- `src/domain`: logic thuần, không phụ thuộc UI, có test (lộ trình, chi phí, ràng buộc, đề xuất, cảnh báo, OCR, Sheet). Có thể chuyển nguyên sang backend.
- `src/services`: OCR (tesseract.js), đọc Google Sheet, xuất Excel.
- `src/pages`, `src/components`: giao diện.
- `src/store.ts`: state và thao tác nghiệp vụ.

## Tab Tối ưu

`src/domain/optimize.ts` đề xuất chuyển hoặc đổi chéo toàn bộ ca của một giáo viên tại một trường, theo tuần hoặc theo ngày, vì chi phí tính theo chặng nên đổi ca lẻ hiếm khi tiết kiệm được. Mỗi đề xuất được thử trên toàn bộ lịch và không được phát sinh trùng lịch hay chặng không kịp, làm nguyện vọng xấu đi, làm một giáo viên thay đổi quá 6 ca/tuần hoặc mất hết ca.

## Giới hạn hiện tại

- Google Sheet chỉ đọc (qua gviz CSV, Sheet phải chia sẻ theo liên kết). Ghi ngược cần OAuth hoặc backend.
- Khoảng cách lấy từ số km đã ghi trong workbook; cặp chưa từng đi được ước tính theo khu vực và gắn nhãn.

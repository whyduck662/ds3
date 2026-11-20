import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = path => JSON.parse(readFileSync(root + path, 'utf8'));
const clean = value => String(value ?? '').replace(/\d{4}-\d{2}-\d{2}(?:[T ][\d:.+Z-]+)?/g, '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
let lines = ['# Tổng hợp các lần kiểm tra', '',
  'Các lần kiểm tra được đánh số theo thứ tự thực hiện, không hiển thị ngày giờ. PASS: đã đạt; FAIL: đã phát hiện lỗi; BLOCKED: chưa thực hiện hoặc chưa đủ điều kiện kiểm chứng.', '',
  'Mỗi lần chỉ xác nhận phạm vi đã chạy. Kết quả cũ không thay thế việc chạy lại sau khi sửa mã. Log, JSON và ảnh gốc được giữ trong `docs/evidence/` để đối chiếu.', ''];
let number = 0;
const introduction = [...lines];
const sections = [];
let currentOrder;
function flush() { if (currentOrder !== undefined) sections.push({ order: currentOrder, lines }); }
function section(scope, order) {
  flush(); currentOrder = order;
  lines = [scope, '']; number++;
}
function row(a, b) { lines.push(`| ${clean(a)} | ${clean(b)} |`); }
function table() { lines.push('| Hạng mục | Kết quả |', '|---|---|'); }

if (existsSync(root + 'docs/evidence/ui/results.json')) {
  section('Kiểm tra giao diện TV1 ban đầu bằng Microsoft Edge headless.', read('docs/evidence/ui/results.json').timestamp); table();
  for (const item of read('docs/evidence/ui/results.json').results) row(item.name, item.status);
  lines.push('', 'Phạm vi: giao diện và fixture TV1; chưa xác nhận toàn bộ nghiệp vụ tích hợp.', '');
}
for (const folder of readdirSync(root + 'docs/evidence/kiem-thu-du-an-ds03').sort()) {
  const base = `docs/evidence/kiem-thu-du-an-ds03/${folder}/`;
  if (!existsSync(root + base + 'results.json')) continue;
  const result = read(base + 'results.json');
  if (result.mode === 'archived-evidence') continue;
  const evidence = result.evidenceDirectory ? base + result.evidenceDirectory + '/' : base;
  section(`Chế độ: ${result.mode}. Kết quả tổng: **${result.acceptance}**.`, result.startedAt); table();
  for (const check of result.checks) {
    let detail = check.status;
    for (const filename of check.evidenceFiles ?? []) {
      if (!filename.endsWith('.json') || !existsSync(root + evidence + filename)) continue;
      let data; try { data = read(evidence + filename); } catch { continue; }
      if (data.numTotalTests !== undefined) detail += `; ${data.numPassedTests}/${data.numTotalTests} tests PASS`;
      else if (data.test === 'C02' && Array.isArray(data.results)) {
        const accepted = data.results.filter(item => item.success === true).length;
        const conflicts = data.results.filter(item => item.success === false && /409/.test(item.error)).length;
        detail += `; C02 ${data.passed ? 'PASS' : 'FAIL'}: ${accepted} thành công, ${conflicts} HTTP 409/${data.results.length} yêu cầu`;
      }
      else if (typeof data.passed === 'boolean') detail += `; ${data.test ?? filename}: ${data.passed ? 'PASS' : 'FAIL'}`;
      else if (Array.isArray(data.results) && data.results.every(item => typeof item.status === 'string')) detail += `; ${data.results.filter(item => item.status === 'PASS').length}/${data.results.length} checks PASS`;
    }
    row(check.testId, `${detail}. ${check.actual ?? ''}`);
  }
  if (existsSync(root + evidence + 'supplemental.json')) {
    lines.push('', 'Kết quả bổ sung của cùng đợt kiểm tra:', '', '```json',
      JSON.stringify(read(evidence + 'supplemental.json'), (key, value) => /(?:At|timestamp|date|time)$/i.test(key) ? undefined : typeof value === 'string' ? clean(value) : value, 2), '```');
  }
  lines.push('');
}
if (existsSync(root + 'docs/evidence/kiem-thu-du-an-ds03/kiem-thu-loi-dong-thoi-driver/driver-status-race.json')) {
  const race = read('docs/evidence/kiem-thu-du-an-ds03/kiem-thu-loi-dong-thoi-driver/driver-status-race.json');
  section('Tái hiện lỗi cạnh tranh giữa cập nhật trạng thái Driver và reserve.', race.statusUpdate.body.lastSeenAt); table();
  row('Reserve A', `HTTP ${race.firstReserve.status}`); row('Cập nhật status', `HTTP ${race.statusUpdate.status}`); row('Reserve B', `HTTP ${race.secondReserve.status}`);
  row('Kết luận', race.confirmed ? 'FAIL: hai yêu cầu reserve có thể cùng thành công.' : 'Chưa tái hiện được lỗi.'); lines.push('');
}
for (const [path, scope] of [
  ['docs/evidence/kiem-thu-du-an-ds03/kiem-thu-loi-dong-thoi-driver/driver-fix-summary.json', 'Kiểm chứng bản sửa tính nguyên tử của trạng thái Driver.'],
  ['docs/evidence/kiem-thu-du-an-ds03/kiem-thu-loi-dong-thoi-driver/kiem-tra-lai-summary.json', 'Kiểm tra lại sau bản sửa Driver; không chạy lại E01–E04 và UI nghiệp vụ trong lần này.'],
]) {
  if (!existsSync(root + path)) continue;
  const summary = read(path);
  section(scope, summary.recordedAt ?? summary.checkedAt); table();
  for (const [key, value] of Object.entries(read(path))) {
    if (['scope', 'recordedAt', 'checkedAt', 'evidence', 'remaining'].includes(key)) continue;
    row(key, typeof value === 'object' ? JSON.stringify(value) : value);
  }
  lines.push('');
}
flush();
sections.sort((a, b) => Date.parse(a.order) - Date.parse(b.order));
lines = [...introduction, ...sections.flatMap((section, index) => [`## Lần kiểm tra ${index + 1}`, '', ...section.lines])];
lines.push('## Các phần chưa hoàn tất', '',
  '- Chưa kiểm chứng triển khai trên máy sạch.',
  '- Đối chiếu các hàng E01–E04 và UI-BUSINESS ở lần kiểm tra mới nhất; PASS của lần cũ không xác nhận lần mới.',
  '- Thông tin hành chính của báo cáo để trống theo yêu cầu.',
  '- Chưa xác nhận commit/push toàn bộ thay đổi, tag/release cuối và quyền truy cập của giảng viên.', '');
writeFileSync(root + 'docs/tong-hop-ket-qua-kiem-thu-ds03.md', lines.join('\n'));
console.log(`Đã tổng hợp ${number} lần kiểm tra vào docs/tong-hop-ket-qua-kiem-thu-ds03.md`);

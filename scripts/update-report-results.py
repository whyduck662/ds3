"""Insert measured results and source evidence into the editable report source."""
from pathlib import Path
import json
import re
import shutil

ROOT = Path(__file__).resolve().parent.parent
pointer = json.loads((ROOT/'docs/evidence/tv1/latest.json').read_text(encoding='utf-8'))
directory = ROOT/pointer['directory']
result = json.loads((directory/'results.json').read_text(encoding='utf-8'))
source = ROOT/'docs/report.md'
content = source.read_text(encoding='utf-8')


def load(name):
    path = directory/name
    return json.loads(path.read_text(encoding='utf-8')) if path.exists() else None


def replace(section, text):
    global content
    pattern = rf'(<!-- {section}_START -->).*?(<!-- {section}_END -->)'
    content, count = re.subn(pattern, lambda match: match[1]+'\n'+text.strip()+'\n'+match[2], content, flags=re.S)
    if count != 1: raise ValueError(f'Missing or duplicate report marker: {section}')


unit, integration, ui = load('UNIT-unit.json'), load('INTEGRATION-TV1-integration.json'), load('UI-TV1-results.json')
rows = ['| Kiểm tra | Kết quả thực tế | Phạm vi |', '|---|---|---|']
for check in result['checks']:
    identifier, status = check['testId'], check['status']
    actual = status
    if identifier == 'UNIT' and unit: actual += f"; {unit['numPassedTests']}/{unit['numTotalTests']} tests"
    if identifier == 'INTEGRATION-TV1' and integration: actual += f"; {integration['numPassedTests']}/{integration['numTotalTests']} tests"
    if identifier == 'UI-TV1' and ui: actual += f"; {sum(item['status']=='PASS' for item in ui['results'])}/{len(ui['results'])} checks"
    scope = {'TYPECHECK': 'Kiểu dữ liệu backend, tools và UI', 'BUILD': 'Biên dịch TypeScript và UI production',
             'UNIT': 'Logic và hồi quy cho các lỗi đã sửa', 'DOCKER': 'Docker Engine hoạt động', 'TEST-INFRA': 'DB/MQ test độc lập sẵn sàng',
             'INTEGRATION-TV1': 'DB/MQ thật: Notification, Payment/Trip, Matching recovery, internal auth, TTL',
             'UI-TV1': 'Auth/role/lỗi/Notification với fixture trên DB/MQ thật', 'STARTUP': 'Build/start/healthcheck/seed qua HTTP',
             'SMOKE': 'Auth, me, notifications và quyền truy cập qua Gateway', 'E01': 'Đặt xe, nhận và hoàn thành/thanh toán',
             'E02': 'Hủy, release Driver, void Payment, thông báo hai bên', 'E03': 'Kill/restart Payment và xử lý tiếp command',
             'E04': 'Reject/rematch, không chọn lại Driver từ chối',
             'CONCURRENCY': 'C01 + C02, gồm trạng thái cuối và cleanup', 'P01': 'API đọc, không phải booking throughput',
             'REDEPLOY': 'Chưa chạy máy sạch; không suy ra từ startup local', 'UI-BUSINESS': 'Hai browser contexts, heartbeat và nghiệp vụ thật'}.get(identifier, check['expected'])
    rows.append(f'| {identifier} | {actual} | {scope} |')
rows += ['', f"Thời điểm kết thúc: {result['endedAt']} (UTC). Tổng trạng thái: **{result['acceptance']}**. Lượt: `{pointer['directory']}/results.json`.",
         'BLOCKED do REDEPLOY nghĩa là chưa kiểm chứng máy sạch, không phải các bài local đang lỗi. Xem từng hàng để phân biệt PASS/FAIL/BLOCKED.']
replace('RESULTS', '\n'.join(rows))

performance = load('P01-p01.json')
if performance:
    rows = ['| Độ đồng thời | Requests | Lỗi | p50 (ms) | p95 (ms) | p99 (ms) | Throughput (req/s) |', '|---|---|---|---|---|---|---|']
    for stage in performance['stages']:
        rows.append(f"| {stage['concurrency']} | {stage['requests']} | {stage['errors']} | {stage['p50Ms']:.2f} | {stage['p95Ms']:.2f} | {stage['p99Ms']:.2f} | {stage['throughputRps']:.2f} |")
    rows += ['', f"Đo từ {performance['startedAt']} tới {performance['endedAt']} (UTC). Workload: {performance['workload']}.",
             f"Môi trường Node {performance['environment']['node']}, {performance['environment']['platform']}, {performance['environment']['cpus']} logical CPUs, RAM {performance['environment']['memory']/1024**3:.1f} GiB.",
             f"Nguồn dữ liệu từng request: `{pointer['directory']}/P01-p01.json`. Các giá trị là một lần chạy local, không phải cam kết SLA."]
    replace('PERFORMANCE','\n'.join(rows))
else: replace('PERFORMANCE','P01 chưa có kết quả trong lượt này; không ghi số liệu giả.')

business = load('UI-BUSINESS-results.json')
figures = []
if business and business['status'] == 'PASS':
    for folder in (ROOT/'artifacts/ui-business').glob('*'):
        record = folder/'results.json'
        if record.exists() and json.loads(record.read_text(encoding='utf-8'))['startedAt'] == business['startedAt']:
            for name, caption in [('passenger-trip','Hình 5.1. Passenger quan sát PAID và CAPTURED từ chuyến thật'),('driver-trip','Hình 5.2. Driver sau khi hoàn thành chuyến thật')]:
                image = folder/(name+'.png')
                if image.exists():
                    shutil.copyfile(image,ROOT/'docs/figures'/(name+'.png'))
                    shutil.copyfile(image,directory/('UI-BUSINESS-'+name+'.png'))
                    figures.append(f'![{caption}](figures/{name}.png)')
            break
replace('UI_FIGURES','\n\n'.join(figures) if figures else 'Bài UI thật có kết quả/ảnh toàn trang trong evidence; chưa có ảnh riêng vùng Trip của lượt này.')
env = result['environment']
evidence = f"Lượt nghiệm thu: `{pointer['directory']}/results.json`. Commit: `{result['commit']}`. Mode: {result['mode']}. Kết thúc: {result['endedAt']} (UTC).\n\n"
evidence += f"Môi trường: Node {env['node']}, {env['platform']} {env['release']}, {env['arch']}, {env['cpus']} logical CPUs, RAM {env['memoryBytes']/1024**3:.1f} GiB.\n\n"
evidence += 'Working tree có thể có thay đổi chưa commit; xem trường workingTree trong results.json, không gán kết quả cho một release chưa tồn tại. Command/expected/actual/log và file phụ nằm trong checks. Báo cáo chỉ sử dụng số liệu từ lượt này; evidence lịch sử được giữ riêng.\n\n'
evidence += '| Thành phần hồ sơ | Đường dẫn trong thư mục lượt chạy |\n|---|---|\n'
for name in ['UNIT-unit.json','INTEGRATION-TV1-integration.json','UI-TV1-results.json','E01-E01.json','E02-E02.json','E03-E03.json','E04-E04.json','UI-BUSINESS-results.json','CONCURRENCY-c01.json','CONCURRENCY-c02.json','P01-p01.json']:
    if (directory/name).exists(): evidence += f'| {name.split("-")[0]} | {name} |\n'
replace('EVIDENCE',evidence)
source.write_text(content,encoding='utf-8')
print(f'Updated report from {pointer["directory"]}; {len(figures)} real UI figures attached.')

import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const directory = 'docs/figures'; mkdirSync(directory, { recursive: true });
const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const text = (x, y, value, size = 17, color = '#17324d') => `<text x="${x}" y="${y}" font-size="${size}" fill="${color}" text-anchor="middle">${escape(value)}</text>`;
const box = (x, y, w, h, title, detail = '', color = '#eaf2fa') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="${color}" stroke="#8aa6c1"/>${text(x+w/2,y+28,title,19)}${detail ? text(x+w/2,y+54,detail,14) : ''}`;
const arrow = (x1, y1, x2, y2, label = '') => `<path d="M ${x1} ${y1} L ${x2} ${y2}" fill="none" stroke="#375b7c" stroke-width="2" marker-end="url(#arrow)"/>${label ? text((x1+x2)/2,(y1+y2)/2-9,label,14) : ''}`;
const svg = (w, h, title, content) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="Arial, sans-serif"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 Z" fill="#375b7c"/></marker></defs><rect width="100%" height="100%" fill="white"/>${text(w/2,35,title,24)}${content}</svg>`;
const figures = {};
let content = box(420,65,360,65,'Web UI — Passenger / Driver','React · HTTP polling / heartbeat') + arrow(600,130,600,170,'HTTP + JWT') + box(420,175,360,65,'API Gateway','Auth, RBAC, CORS, timeout, quota');
const services = ['Identity','Driver','Trip','Matching ×2','Payment','Notification'];
for (let index = 0; index < services.length; index++) {
  const x = 15 + index * 198;
  content += box(x,290,180,65,services[index], 'Process / container riêng') + box(x,450,180,65,`${services[index].replace(' ×2','')} DB`,'PostgreSQL riêng','#f1f5f9') + arrow(x+90,355,x+90,445);
  if (index !== 3) content += `<path d="M600 240 V262 H${x+90} V285" fill="none" stroke="#7994ad" marker-end="url(#arrow)"/>`;
}
content += box(200,565,800,65,'RabbitMQ — ride.commands / ride.events','Async command/event · manual ACK · retry queues · DLQ','#fff1d9');
content += text(600,660,'Driver / Trip / Matching / Payment / Notification giao tiếp MQ; Identity phục vụ HTTP.',16);
figures.architecture = svg(1200,690,'Hình 3.1 — Kiến trúc DS03 và ranh giới dữ liệu',content);

const names=['Trip','Payment','Matching','Driver','Notification'], xs=[120,350,580,810,1040];
content='';
names.forEach((name,index)=>{ content+=box(xs[index]-85,65,170,52,name); content+=`<line x1="${xs[index]}" y1="120" x2="${xs[index]}" y2="810" stroke="#c1d0df" stroke-dasharray="7 7"/>`; });
const steps=[[0,1,'payment.authorize (MQ)'],[1,0,'payment.authorized'],[0,2,'matching.find_driver (MQ)'],[2,3,'reserve (REST, reservationId)'],[3,2,'reservationVersion'],[2,0,'matching.driver_reserved'],[0,3,'confirm khi Driver accept (REST)'],[0,4,'trip.accepted / trip.started'],[0,1,'payment.capture sau complete'],[1,0,'payment.captured (status + amount)'],[0,4,'trip.paid → hai recipients'],[0,3,'trip.completed → release (MQ)']];
steps.forEach(([from,to,label],index)=>{ const y=158+index*53; content+=arrow(xs[from],y,xs[to],y,label); });
figures.saga = svg(1160,840,'Hình 3.4 — Luồng đặt xe và thanh toán thành công',content);

const data=[['Identity DB','users','id · email UNIQUE · password_hash · role'],['Driver DB','drivers','status · current_trip_id · reservation_id'],['Trip DB','trips + idempotency_keys','status · payment_status · saga_status'],['Matching DB','match_attempts','trip_id + attempt UNIQUE · lease · candidate'],['Payment DB','payments','trip_id UNIQUE · amount · status · version'],['Notification DB','notifications + processed_messages','user_id · event_id · trip_id · type']];
content='';
data.forEach(([title,table,fields],index)=>{ const x=20+(index%3)*395,y=85+Math.floor(index/3)*235;content+=box(x,y,375,185,title,table);content+=text(x+187,y+92,fields,13);content+=text(x+187,y+123,index===0?'Schema migrations':'Outbox / inbox theo vai trò',15);content+=text(x+187,y+154,'Chỉ owner truy cập DB',15); });
content+=text(600,590,'UUID liên service là tham chiếu logic qua HTTP/MQ, không phải foreign key hoặc JOIN xuyên DB.',17);
figures.datamodel=svg(1200,620,'Hình 3.3 — Mô hình dữ liệu theo service',content);

content=box(55,90,285,75,'PENDING','Inbox + work item COMMIT')+arrow(340,125,425,125)+box(430,90,300,75,'RUNNING / claim','Lease + claim_token COMMIT')+arrow(730,125,815,125)+box(820,90,315,75,'RESERVING','Candidate + reservationId COMMIT');
content+=arrow(975,165,975,270,'REST reserve');
content+=box(815,275,320,75,'RESERVED + reply','Transaction outbox COMMIT','#e2f3e9');
content+=box(55,275,360,75,'CANCEL_REQUESTED','Tombstone bền vững','#fff1d9')+arrow(415,312,505,312,'release / đối soát')+box(510,275,285,75,'CANCELLED + ACK','Chỉ sau release xác nhận','#e2f3e9');
content+=text(600,425,'Crash: worker mới đọc DB, claim lại lease hết hạn và dùng cùng reservationId.',19);
content+=text(600,465,'Timeout/503: giữ trạng thái; retry sau 2 giây. Không ACK hủy trên lỗi mạng.',19);
figures['matching-recovery']=svg(1200,500,'Hình 3.2 — Matching durable worker và recovery',content);

const browser=await chromium.launch({channel:process.env.REPORT_BROWSER??'msedge',headless:true});
try {
  const page=await browser.newPage();
  for(const [name,value] of Object.entries(figures)){
    writeFileSync(`${directory}/${name}.svg`,value);
    await page.setContent(`<html><body style="margin:0">${value}</body></html>`);
    await page.locator('svg').screenshot({path:`${directory}/${name}.png`});
  }
} finally { await browser.close(); }
console.log('Created four source SVG diagrams and PNG report figures.');

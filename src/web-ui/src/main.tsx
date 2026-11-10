import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

type Session = { accessToken: string; user: { name: string; role: string } };
function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState('passenger1@demo.local');
  const [password, setPassword] = useState('DemoPass123!');
  const [name, setName] = useState('');
  const [role, setRole] = useState('PASSENGER');
  const [register, setRegister] = useState(false);
  const [message, setMessage] = useState('');
  const [trip, setTrip] = useState<any>(null);
  const [offers, setOffers] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [coordinates, setCoordinates] = useState({ lat: '10.7769', lng: '106.7009', toLat: '10.782', toLng: '106.71' });
  const [busy, setBusy] = useState(false);
  async function api(path: string, method = 'GET', body?: unknown, extraHeaders = {}) {
    const response = await fetch((import.meta.env.VITE_API_URL ?? 'http://localhost:8080') + path, { method, signal: AbortSignal.timeout(5000), headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.accessToken}` } : {}), ...extraHeaders }, body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw new Error(`${result.code}: ${result.message}`);
    return result;
  }
  async function action(work: () => Promise<void>) {
    setBusy(true); setMessage('');
    try { await work(); } catch (error) { setMessage(String(error)); } finally { setBusy(false); }
  }
  useEffect(() => {
    if (!session) return;
    let active = true;
    const refresh = async () => {
      const results = await Promise.allSettled([
        api('/notifications/me'),
        api(session.user.role === 'DRIVER' ? '/trips/offers' : '/trips/me/active')
      ]);
      if (!active) return;
      if (results[0].status === 'fulfilled') setNotifications(results[0].value.items);
      if (results[1].status === 'fulfilled') {
        if (session.user.role === 'DRIVER') setOffers(results[1].value.items ?? results[1].value);
        else setTrip(results[1].value.trip ?? results[1].value);
      }
      const rejected = results.find(r => r.status === 'rejected');
      if (rejected?.status === 'rejected') setMessage(String(rejected.reason));
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    return () => { active = false; clearInterval(timer); };
  }, [session]);
  return <main><h1>DS03 · Đặt xe</h1><p>Ứng dụng mô phỏng đặt xe của nhóm 03</p>
    {!session ? <form onSubmit={e => { e.preventDefault(); void action(async () => {
      if (register) { await api('/auth/register', 'POST', { email, password, name, role }); setRegister(false); setMessage('Đăng ký thành công. Bạn có thể đăng nhập.'); }
      else setSession(await api('/auth/login', 'POST', { email, password }));
    }); }}><h2>{register ? 'Đăng ký' : 'Đăng nhập'}</h2>
      <label>Email<input type="email" required value={email} onChange={e => setEmail(e.target.value)} /></label>
      <label>Mật khẩu<input type="password" required minLength={8} maxLength={72} value={password} onChange={e => setPassword(e.target.value)} /></label>
      {register && <><label>Họ tên<input required value={name} onChange={e => setName(e.target.value)} /></label><label>Vai trò<select value={role} onChange={e => setRole(e.target.value)}><option value="PASSENGER">Hành khách</option><option value="DRIVER">Tài xế</option></select></label></>}
      <button disabled={busy}>{register ? 'Tạo tài khoản' : 'Đăng nhập'}</button><button type="button" onClick={() => setRegister(!register)}>{register ? 'Về đăng nhập' : 'Đăng ký mới'}</button>
    </form> : <><p>{session.user.name} · {session.user.role} <button onClick={() => { setSession(null); setTrip(null); setOffers([]); setNotifications([]); setMessage(''); }}>Đăng xuất</button></p>
      <section><h2>{session.user.role === 'DRIVER' ? 'Vị trí tài xế' : 'Đặt chuyến'}</h2>
        {Object.entries(coordinates).filter(([key]) => session.user.role !== 'DRIVER' || !key.startsWith('to')).map(([key, value]) => <label key={key}>{({ lat: 'Vĩ độ đón', lng: 'Kinh độ đón', toLat: 'Vĩ độ đến', toLng: 'Kinh độ đến' } as Record<string,string>)[key]}<input type="number" step="any" value={value} onChange={e => setCoordinates({ ...coordinates, [key]: e.target.value })} /></label>)}
        {session.user.role === 'PASSENGER' ? <button disabled={busy} onClick={() => void action(async () => setTrip(await api('/trips', 'POST', { pickup: { lat: +coordinates.lat, lng: +coordinates.lng }, dropoff: { lat: +coordinates.toLat, lng: +coordinates.toLng } }, { 'Idempotency-Key': crypto.randomUUID() })))}>Đặt xe</button> : <>
          <button disabled={busy} onClick={() => void action(async () => { await api('/drivers/me/location', 'PUT', { lat: +coordinates.lat, lng: +coordinates.lng }); await api('/drivers/me/status', 'PUT', { status: 'AVAILABLE' }); setMessage('Đã trực tuyến'); })}>Trực tuyến / cập nhật vị trí</button>
          <button disabled={busy} onClick={() => void action(async () => { await api('/drivers/me/status', 'PUT', { status: 'OFFLINE' }); setMessage('Đã ngoại tuyến'); })}>Ngoại tuyến</button>
        </>}
      </section>
      <section><h2>Chuyến đi</h2>{session.user.role === 'DRIVER' && offers.map(offer => <p key={offer.id ?? offer.tripId}><button onClick={() => setTrip(offer)}>Xem chuyến {offer.id ?? offer.tripId}</button></p>)}
        {trip && (trip.id ?? trip.tripId) ? <><p>Mã chuyến: {trip.id ?? trip.tripId}</p><p>Trạng thái: {trip.status}</p><p>Correlation ID: {trip.correlationId ?? 'Chưa có'}</p>
          {(session.user.role === 'PASSENGER' ? ['cancel'] : ['accept','reject','start','complete']).map(command => <button key={command} disabled={busy} onClick={() => void action(async () => { await api(`/trips/${trip.id ?? trip.tripId}/${command}`, 'POST', {}); setTrip(await api(`/trips/${trip.id ?? trip.tripId}`)); })}>{({cancel:'Hủy chuyến',accept:'Nhận chuyến',reject:'Từ chối',start:'Bắt đầu',complete:'Hoàn thành'} as Record<string,string>)[command]}</button>)}</> : <p>Chưa có chuyến.</p>}
      </section><section><h2>Thông báo</h2>{notifications.length ? notifications.map(n => <p key={n.id}>{n.type} · {n.tripId}</p>) : <p>Chưa có thông báo.</p>}</section>
    </>}{message && <p role="status" className="message">{message}</p>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<App />);

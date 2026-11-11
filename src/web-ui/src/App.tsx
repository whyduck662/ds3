import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';
import { places, type Place } from './locations';
import { money, terminal, type Driver, type Notification, type Payment, type Session, type Trip } from './types';

const labels: Record<string, string> = { REQUESTED: 'Đã yêu cầu', SEARCHING: 'Đang tìm tài xế', DRIVER_ASSIGNED: 'Chờ tài xế nhận', ACCEPTING: 'Đang xác nhận', ACCEPTED: 'Đã nhận', IN_PROGRESS: 'Đang di chuyển', COMPLETED: 'Đã đến nơi, chờ thanh toán', PAID: 'Đã thanh toán', COMPENSATING: 'Đang xử lý hủy', CANCELLED: 'Đã hủy' };
const notificationLabels: Record<string, string> = { 'trip.requested': 'Đã đặt chuyến', 'trip.accepted': 'Tài xế đã nhận chuyến', 'trip.started': 'Chuyến đi bắt đầu', 'trip.completed': 'Chuyến đi hoàn thành', 'trip.cancelled': 'Chuyến đi đã hủy', 'trip.paid': 'Đã thanh toán chuyến đi' };

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState('passenger1@demo.local');
  const [password, setPassword] = useState('DemoPass123!');
  const [name, setName] = useState('');
  const [role, setRole] = useState('PASSENGER');
  const [register, setRegister] = useState(false);
  const [message, setMessage] = useState('');
  const [pollError, setPollError] = useState('');
  const [trip, setTrip] = useState<Trip | null>(null);
  const [tripId, setTripId] = useState<string | null>(null);
  const [offers, setOffers] = useState<Trip[]>([]);
  const [driver, setDriver] = useState<Driver | null>(null);
  const [payment, setPayment] = useState<Payment | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [pickupPlace, setPickupPlace] = useState<Place>(places[0]);
  const [dropoffPlace, setDropoffPlace] = useState<Place>(places[1]);
  const [locating, setLocating] = useState(false);
  const [busy, setBusy] = useState(false);
  const pointRef = useRef(pickupPlace);
  const bookingKey = useRef<string | null>(null);
  pointRef.current = pickupPlace;
  function logout() {
    setSession(null); setTrip(null); setTripId(null); setDriver(null); setOffers([]); setNotifications([]); setPayment(null); setPollError('');
    bookingKey.current = null;
  }
  function report(error: unknown) {
    if (error instanceof ApiError && error.status === 401) { logout(); setMessage('Phiên đã hết hạn. Vui lòng đăng nhập lại.'); }
    else setMessage(error instanceof Error ? error.message : String(error));
  }
  async function action(work: () => Promise<void>) {
    setBusy(true); setMessage('');
    try { await work(); } catch (error) { report(error); } finally { setBusy(false); }
  }
  function location() { return { lat: pointRef.current.lat, lng: pointRef.current.lng }; }
  function choosePickup(place: Place) {
    bookingKey.current = null;
    pointRef.current = place;
    setPickupPlace(place);
  }
  function useCurrentLocation() {
    if (!navigator.geolocation) { setMessage('Trình duyệt không hỗ trợ định vị. Bạn có thể chọn địa điểm trong danh sách.'); return; }
    setLocating(true); setMessage('');
    navigator.geolocation.getCurrentPosition(position => {
      choosePickup({ id: 'current', name: 'Vị trí hiện tại của bạn', address: 'Vị trí được lấy từ thiết bị', lat: position.coords.latitude, lng: position.coords.longitude });
      setLocating(false);
    }, error => {
      setLocating(false);
      setMessage(error.code === 1 ? 'Bạn chưa cho phép truy cập vị trí. Hãy chọn địa điểm trong danh sách hoặc cấp quyền định vị.' : 'Chưa lấy được vị trí. Hãy thử lại hoặc chọn địa điểm trong danh sách.');
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
  }
  function validatePoint(lat: number, lng: number) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new Error('Tọa độ không hợp lệ');
  }
  useEffect(() => {
    if (!session) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      const errors: unknown[] = [];
      try {
        const result = await api<{ items: Notification[] }>('/notifications/me', session!.accessToken);
        if (active) setNotifications(result.items);
      } catch (error) { errors.push(error); }
      try {
        let id = tripId;
        if (session!.user.role === 'DRIVER') {
          const profile = await api<Driver>('/drivers/me', session!.accessToken);
          const availableOffers = await api<{ items: Trip[] }>('/trips/offers', session!.accessToken);
          if (active) { setDriver(profile); setOffers(availableOffers.items); }
          id = profile.currentTripId ?? id;
        } else if (session!.user.role === 'PASSENGER' && !id) {
          const current = await api<{ trip: Trip | null }>('/trips/me/active', session!.accessToken);
          if (active) setTrip(current.trip);
          id = current.trip?.id ?? null;
        }
        if (id) {
          const current = await api<Trip>(`/trips/${id}`, session!.accessToken);
          if (active) { setTrip(current); setTripId(id); }
          if (['COMPLETED', 'PAID'].includes(current.status)) {
            const currentPayment = await api<Payment>(`/payments/${id}`, session!.accessToken);
            if (active) setPayment(currentPayment);
          }
        }
      } catch (error) { errors.push(error); }
      if (!active) return;
      if (errors.some(error => error instanceof ApiError && error.status === 401)) {
        logout(); setMessage('Phiên đã hết hạn. Vui lòng đăng nhập lại.'); return;
      }
      setPollError(errors.map(error => error instanceof Error ? error.message : String(error)).join(' · '));
      timer = setTimeout(() => void refresh(), 2000);
    }
    void refresh();
    return () => { active = false; clearTimeout(timer); };
  }, [session, tripId]);
  // Location cũng là heartbeat theo contract TV3; không đổi availability khi đang có chuyến.
  const online = session?.user.role === 'DRIVER' && !!driver && driver.status !== 'OFFLINE';
  useEffect(() => {
    if (!session || !online) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function heartbeat() {
      try {
        const point = location(); validatePoint(point.lat, point.lng);
        await api('/drivers/me/location', session!.accessToken, 'PUT', point);
      } catch (error) { if (active) report(error); }
      if (active) timer = setTimeout(() => void heartbeat(), 5000);
    }
    timer = setTimeout(() => void heartbeat(), 5000);
    return () => { active = false; clearTimeout(timer); };
  }, [session, online]);
  const driverActions = trip?.status === 'DRIVER_ASSIGNED' ? ['accept', 'reject'] : trip?.status === 'ACCEPTED' ? ['start'] : trip?.status === 'IN_PROGRESS' ? ['complete'] : [];
  return <main><h1>DS03 · Đặt xe</h1><p>Ứng dụng mô phỏng đặt xe của nhóm 03</p>
    {!session ? <form onSubmit={event => { event.preventDefault(); void action(async () => {
      if (register) { await api('/auth/register', undefined, 'POST', { email, password, name, role }); setRegister(false); setMessage('Đăng ký thành công. Bạn có thể đăng nhập.'); }
      else setSession(await api<Session>('/auth/login', undefined, 'POST', { email, password }));
    }); }}><h2>{register ? 'Đăng ký' : 'Đăng nhập'}</h2>
      <label>Email<input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /></label>
      <label>Mật khẩu<input type="password" autoComplete={register ? 'new-password' : 'current-password'} required minLength={8} maxLength={72} value={password} onChange={e => setPassword(e.target.value)} /></label>
      {register && <><label>Họ tên<input required maxLength={100} value={name} onChange={e => setName(e.target.value)} /></label><label>Vai trò<select value={role} onChange={e => setRole(e.target.value)}><option value="PASSENGER">Hành khách</option><option value="DRIVER">Tài xế</option></select></label></>}
      <button disabled={busy}>{register ? 'Tạo tài khoản' : 'Đăng nhập'}</button><button disabled={busy} type="button" onClick={() => setRegister(!register)}>{register ? 'Về đăng nhập' : 'Đăng ký mới'}</button>
    </form> : <><p>{session.user.name} · {session.user.role} <button onClick={logout}>Đăng xuất</button></p>
      {session.user.role !== 'ADMIN' && <section><h2>{session.user.role === 'DRIVER' ? 'Vị trí tài xế' : 'Đặt chuyến'}</h2>
        {driver && <p>Trạng thái tài xế: {driver.status}</p>}
        <p className="location-hint">Chọn địa điểm có sẵn tại Hà Nội để thử đặt xe, hoặc dùng vị trí hiện tại làm {session.user.role === 'DRIVER' ? 'vị trí tài xế' : 'điểm đón'}.</p>
        <label>{session.user.role === 'DRIVER' ? 'Bạn đang ở đâu?' : 'Đón bạn ở đâu?'}<select disabled={busy || locating} value={pickupPlace.id} onChange={e => choosePickup(places.find(place => place.id === e.target.value)!)}>
          {pickupPlace.id === 'current' && <option value="current">Vị trí hiện tại của bạn</option>}
          {places.map(place => <option key={place.id} value={place.id}>{place.name}</option>)}
        </select></label>
        <p className="place-address">{pickupPlace.address}</p>
        <button type="button" disabled={busy || locating} onClick={useCurrentLocation}>{locating ? 'Đang lấy vị trí…' : 'Dùng vị trí hiện tại'}</button>
        {session.user.role === 'PASSENGER' && <><label>Bạn muốn đến đâu?<select disabled={busy} value={dropoffPlace.id} onChange={e => { bookingKey.current = null; setDropoffPlace(places.find(place => place.id === e.target.value)!); }}>
          {places.map(place => <option key={place.id} value={place.id}>{place.name}</option>)}
        </select></label><p className="place-address">{dropoffPlace.address}</p></>}
        {session.user.role === 'PASSENGER' ? <button disabled={busy || locating || !terminal(trip) || pickupPlace.id === dropoffPlace.id} onClick={() => void action(async () => {
          const pickup = location(), dropoff = { lat: dropoffPlace.lat, lng: dropoffPlace.lng };
          validatePoint(pickup.lat, pickup.lng); validatePoint(dropoff.lat, dropoff.lng);
          bookingKey.current ??= crypto.randomUUID();
          const created = await api<Trip>('/trips', session.accessToken, 'POST', { pickup, dropoff }, { 'Idempotency-Key': bookingKey.current });
          setTrip(created); setTripId(created.id); setPayment(null); bookingKey.current = null;
        })}>Đặt xe</button> : <>
          <button disabled={busy || locating || !!driver && !['OFFLINE', 'AVAILABLE'].includes(driver.status)} onClick={() => void action(async () => {
            const point = location(); validatePoint(point.lat, point.lng);
            await api('/drivers/me/location', session.accessToken, 'PUT', point);
            setDriver(await api<Driver>('/drivers/me/status', session.accessToken, 'PUT', { status: 'AVAILABLE' }));
          })}>Trực tuyến</button>
          <button disabled={busy || !driver || driver.status !== 'AVAILABLE'} onClick={() => void action(async () => setDriver(await api<Driver>('/drivers/me/status', session.accessToken, 'PUT', { status: 'OFFLINE' })))}>Ngoại tuyến</button>
        </>}
        {session.user.role === 'PASSENGER' && pickupPlace.id === dropoffPlace.id && <p role="status">Hãy chọn điểm đến khác điểm đón.</p>}
      </section>}
      <section><h2>Chuyến đi</h2>{session.user.role === 'DRIVER' && offers.map(offer => <p key={offer.id}><button disabled={busy} onClick={() => { setTrip(offer); setTripId(offer.id); setPayment(null); }}>Xem đề nghị {offer.id}</button></p>)}
        {trip ? <><p>Mã chuyến: {trip.id}</p><p>Trạng thái: {labels[trip.status] ?? trip.status}</p><p>Giá cước: {money(trip.quotedFare)}</p><p>Thanh toán: {payment?.status ?? trip.paymentStatus ?? 'Chưa hoàn tất'}{payment && ` · ${money(payment.amount)}`}</p><p>Correlation ID: {trip.correlationId}</p>
          {(session.user.role === 'PASSENGER' ? !['IN_PROGRESS', 'COMPLETED', 'PAID', 'CANCELLED', 'COMPENSATING'].includes(trip.status) ? ['cancel'] : [] : session.user.role === 'DRIVER' ? driverActions : []).map(command => <button key={command} disabled={busy} onClick={() => void action(async () => {
            await api(`/trips/${trip.id}/${command}`, session.accessToken, 'POST', {});
            setTrip(await api<Trip>(`/trips/${trip.id}`, session.accessToken));
          })}>{({ cancel: 'Hủy chuyến', accept: 'Nhận chuyến', reject: 'Từ chối', start: 'Bắt đầu', complete: 'Hoàn thành' } as Record<string, string>)[command]}</button>)}</> : <p>Chưa có chuyến.</p>}
      </section><section><h2>Thông báo</h2>{notifications.length ? notifications.map(n => <p key={n.id}>{notificationLabels[n.type] ?? n.type} · {n.tripId}</p>) : <p>Chưa có thông báo.</p>}</section>
    </>}{message && <p role="status" className="message">{message}</p>}{pollError && <p role="status" className="message">{pollError}</p>}
  </main>;
}

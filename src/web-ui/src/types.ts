export type Session = { accessToken: string; user: { userId: string; name: string; role: 'PASSENGER' | 'DRIVER' | 'ADMIN' } };
export type Trip = { id: string; status: string; correlationId: string; quotedFare: number; paymentStatus?: string };
export type Driver = { status: 'OFFLINE' | 'AVAILABLE' | 'RESERVED' | 'ON_TRIP'; currentTripId: string | null };
export type Payment = { status: string; amount: number };
export type Notification = { id: string; tripId: string; type: string; createdAt: string };
export const terminal = (trip: Trip | null) => !trip || ['PAID', 'CANCELLED'].includes(trip.status);
export const money = (value?: number) => value === undefined ? 'Chưa có' : new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(value);

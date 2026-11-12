export interface Coordinates {
  lat: number;
  lng: number;
}

// Tính khoảng cách giữa 2 toạ độ theo công thức Haversine (km)
export function haversineDistance(c1: Coordinates, c2: Coordinates): number {
  const R = 6371; // Bán kính Trái Đất (km)
  const dLat = ((c2.lat - c1.lat) * Math.PI) / 180;
  const dLng = ((c2.lng - c1.lng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((c1.lat * Math.PI) / 180) *
      Math.cos((c2.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Tính cước cố định (integer VND): 12.000đ mở cửa + 10.000đ/km, làm tròn đến hàng nghìn
export function calculateFare(pickup: Coordinates, dropoff: Coordinates): number {
  const km = haversineDistance(pickup, dropoff);
  const base = 12000;
  const rawFare = base + km * 10000;
  return Math.max(12000, Math.round(rawFare / 1000) * 1000);
}


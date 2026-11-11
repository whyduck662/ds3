export type Place = { id: string; name: string; address: string; lat: number; lng: number };

// Các điểm mô phỏng gần nhau để thuận tiện thử đặt xe và matching.
export const places: Place[] = [
  { id: 'hoan-kiem', name: 'Hồ Hoàn Kiếm', address: 'Đinh Tiên Hoàng, Hà Nội', lat: 21.0287, lng: 105.8524 },
  { id: 'opera-house', name: 'Nhà hát Lớn Hà Nội', address: 'Tràng Tiền, Hà Nội', lat: 21.0242, lng: 105.8576 },
  { id: 'cathedral', name: 'Nhà thờ Lớn Hà Nội', address: 'Nhà Chung, Hà Nội', lat: 21.0286, lng: 105.8488 },
  { id: 'dong-xuan', name: 'Chợ Đồng Xuân', address: 'Đồng Xuân, Hà Nội', lat: 21.0380, lng: 105.8502 },
  { id: 'temple-literature', name: 'Văn Miếu – Quốc Tử Giám', address: 'Quốc Tử Giám, Hà Nội', lat: 21.0273, lng: 105.8355 },
];

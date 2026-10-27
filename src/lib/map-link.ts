/** Link mở vị trí trên Google Maps (điện thoại tự mở ứng dụng bản đồ). */
export function mapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

/** Bản đồ nhỏ nhúng sẵn của OpenStreetMap, không cần khoá API. */
export function mapEmbedUrl(lat: number, lng: number): string {
  const d = 0.003;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${lng - d},${lat - d},${lng + d},${lat + d}&layer=mapnik&marker=${lat},${lng}`;
}

export function coordText(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

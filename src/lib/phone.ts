const PHONE_HOST = "phone.vaoca.app";

/** Chuẩn hóa số Việt Nam về dạng 84 + 9 số. Trả về null nếu không phải số di động. */
export function normalizeVnPhone(input: string): string | null {
  let digits = input.trim().replace(/[\s.-]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  if (digits.startsWith("0")) digits = `84${digits.slice(1)}`;
  if (!/^84\d{9}$/.test(digits)) return null;
  return digits;
}

export function phoneLoginEmail(phone: string): string {
  return `${phone}@${PHONE_HOST}`;
}

export function phoneFromLoginEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const match = email.toLowerCase().match(/^(\d{11})@phone\.vaoca\.app$/);
  return match?.[1] ?? null;
}

export function displayPhone(stored: string): string {
  const digits = stored.replace(/\D/g, "");
  const local = digits.startsWith("84") && digits.length === 11 ? `0${digits.slice(2)}` : digits;
  if (local.length !== 10) return stored;
  return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
}

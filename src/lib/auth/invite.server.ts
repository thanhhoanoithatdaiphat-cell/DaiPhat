/** Mã mời công ty (chỉ chạy phía server). Mã lưu dạng chuẩn hóa: 8 ký tự chữ HOA + số, bỏ I, L, O, 0, 1 cho dễ đọc. */
import { randomInt } from "node:crypto";
import { APIError } from "better-auth/api";
import { getSql } from "../db";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const COMPANY_ID = "co-default";

export function newInviteCode(): string {
  return Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
}

export function normalizeInvite(value: unknown): string {
  return typeof value === "string" ? value.toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
}

export function formatInvite(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

export async function ensureInviteCode(companyId: string): Promise<string> {
  const sql = await getSql();
  const rows = await sql<{ invite_code: string | null }>`select invite_code from companies where id = ${companyId}`;
  if (rows[0]?.invite_code) return rows[0].invite_code;
  const created = await sql<{ invite_code: string }>`
    update companies set invite_code = ${newInviteCode()} where id = ${companyId} and invite_code is null returning invite_code
  `;
  if (created[0]) return created[0].invite_code;
  const again = await sql<{ invite_code: string | null }>`select invite_code from companies where id = ${companyId}`;
  if (!again[0]?.invite_code) throw new Error("Không tạo được mã mời");
  return again[0].invite_code;
}

export async function regenerateInviteCode(companyId: string): Promise<string> {
  const sql = await getSql();
  const code = newInviteCode();
  await sql`update companies set invite_code = ${code} where id = ${companyId}`;
  return code;
}

/**
 * Chặn đăng ký nếu mã mời sai. Người đầu tiên của hệ thống (chưa có tài khoản nào) được đăng ký không cần mã để trở thành quản trị.
 * Sau đó mà công ty chưa có mã thì đóng đăng ký cho tới khi quản trị lấy mã trong Cài đặt.
 */
export async function assertInviteAllowed(input: unknown): Promise<void> {
  const sql = await getSql();
  const users = await sql<{ n: number }>`select count(*)::int as n from "user"`;
  // Mặc định người đầu tiên được đăng ký không cần mã để trở thành quản trị.
  // Đặt REQUIRE_INVITE_ALWAYS=true để tắt cửa sổ này (an toàn hơn nếu URL công khai sớm).
  const lockFirst = process.env.REQUIRE_INVITE_ALWAYS === "true";
  if (!lockFirst && Number(users[0]?.n ?? 0) === 0) return;
  const rows = await sql<{ invite_code: string | null }>`select invite_code from companies where id = ${COMPANY_ID}`;
  const stored = rows[0]?.invite_code;
  if (!stored) {
    throw new APIError("FORBIDDEN", { message: "Công ty chưa mở đăng ký. Hãy nhờ quản trị lấy mã mời trong Cài đặt." });
  }
  if (normalizeInvite(input) !== stored) {
    throw new APIError("BAD_REQUEST", { message: "Mã mời công ty chưa đúng." });
  }
}

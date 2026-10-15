/**
 * Better Auth cho Vào Ca (chỉ chạy phía server).
 * Đăng nhập bằng số điện thoại + mật khẩu (số được đổi thành email nội bộ, xem `@/lib/phone`).
 * Dữ liệu lưu ở Postgres khi có DATABASE_URL (Neon), nếu không thì dùng PGLite trong bộ nhớ để chạy thử ở máy.
 */
import { betterAuth } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { phoneNumber } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { ensureDbReady, getPglite, getSql } from "../db";
import { normalizeVnPhone, phoneFromLoginEmail } from "../phone";
import { assertInviteAllowed } from "./invite.server";
import { sendSms } from "./sms.server";
import { pgliteDialect } from "./pglite-dialect";

void ensureDbReady();

const env = (key: string): string | undefined => {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
};

function withProtocol(host: string | undefined): string | undefined {
  if (!host) return undefined;
  return /^https?:\/\//.test(host) ? host : `https://${host}`;
}

// Địa chỉ gốc của app: ưu tiên BETTER_AUTH_URL, sau đó các biến Vercel tự cấp.
const baseURL =
  env("BETTER_AUTH_URL") ??
  withProtocol(env("VERCEL_PROJECT_PRODUCTION_URL")) ??
  withProtocol(env("VERCEL_URL")) ??
  "http://localhost:8080";

const trustedOrigins = Array.from(
  new Set([
    baseURL,
    withProtocol(env("VERCEL_URL")),
    withProtocol(env("VERCEL_BRANCH_URL")),
    "http://localhost:8080",
    "http://127.0.0.1:8080",
    ...(env("TRUSTED_ORIGINS")?.split(",").map((s) => s.trim()).filter(Boolean) ?? []),
  ].filter((v): v is string => Boolean(v))),
);

// Giữ secret ổn định qua HMR khi chạy thử; production bắt buộc đặt BETTER_AUTH_SECRET.
const globalRef = globalThis as typeof globalThis & { __authDevSecret__?: string };
function secret(): string {
  const fromEnv = env("BETTER_AUTH_SECRET");
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === "production") {
    throw new Error("Thiếu BETTER_AUTH_SECRET. Hãy đặt biến môi trường này trên Vercel.");
  }
  globalRef.__authDevSecret__ ??= randomBytes(32).toString("hex");
  return globalRef.__authDevSecret__;
}

const databaseUrl = env("DATABASE_URL");
if (!databaseUrl && process.env.NODE_ENV === "production") {
  throw new Error("Thiếu DATABASE_URL. Hãy đặt chuỗi kết nối Neon trên Vercel.");
}
const database = databaseUrl
  ? new Pool({ connectionString: databaseUrl, max: 5 })
  : { dialect: pgliteDialect(() => getPglite()), type: "postgres" as const };

export const auth = betterAuth({
  baseURL,
  secret: secret(),
  database,
  trustedOrigins,
  emailAndPassword: { enabled: true, minPasswordLength: 8, revokeSessionsOnPasswordReset: true },
  hooks: {
    // Kiểm tra mã mời ở server, không phụ thuộc giao diện.
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === "/sign-up/email") {
        await assertInviteAllowed((ctx.body as { inviteCode?: unknown } | undefined)?.inviteCode);
      }
    }),
  },
  databaseHooks: {
    user: {
      create: {
        // Số điện thoại lấy từ email nội bộ ở server, không tin dữ liệu client gửi lên.
        before: async (user) => ({
          data: { ...user, phoneNumber: phoneFromLoginEmail(user.email) ?? undefined },
        }),
      },
    },
  },
  session: { cookieCache: { enabled: true, maxAge: 300 } },
  plugins: [
    phoneNumber({
      otpLength: 6,
      expiresIn: 300,
      allowedAttempts: 3,
      phoneNumberValidator: (value) => normalizeVnPhone(value) === value,
      // Đăng nhập chỉ bằng mật khẩu; OTP chỉ dùng để đặt lại mật khẩu. Tắt gửi OTP chung để không ai lạm dụng gửi SMS.
      sendOTP: async () => {
        throw new Error("Không hỗ trợ đăng nhập bằng OTP.");
      },
      sendPasswordResetOTP: async ({ phoneNumber: phone, code }) => {
        // Tối đa 3 mã mỗi giờ cho mỗi số (tránh tốn tiền SMS khi bị lạm dụng). Vượt mức thì im lặng không gửi.
        const sql = await getSql();
        const rows = await sql<{ n: number }>`
          select count(*)::int as n from "verification"
          where "identifier" = ${`${phone}-request-password-reset`} and "createdAt" > now() - interval '1 hour'`;
        if (Number(rows[0]?.n ?? 0) > 3) return;
        await sendSms(phone, `VaoCa: Ma xac nhan dat lai mat khau la ${code}. Het han sau 5 phut. Khong chia se ma nay.`);
      },
    }),
    // Phải đứng cuối để đẩy Set-Cookie vào response của TanStack Start.
    tanstackStartCookies(),
  ],
});

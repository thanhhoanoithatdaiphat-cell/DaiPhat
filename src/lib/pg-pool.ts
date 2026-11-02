/**
 * Pool Postgres DUY NHẤT cho cả dữ liệu ứng dụng (db.ts) và đăng nhập (Better Auth).
 *
 * Trước đây hai nơi tự tạo pool riêng (mặc định 10 + 5 = 15 kết nối cho MỖI instance serverless),
 * đúng bằng pool_size 15 của bộ gom kết nối ở chế độ session → chỉ một vài instance là cạn
 * và app báo "(EMAXCONNSESSION) max clients reached in session mode".
 *
 * Mỗi instance serverless chỉ xử lý ít yêu cầu cùng lúc nên giữ pool rất nhỏ; kết nối rảnh được
 * trả lại nhanh để các instance khác dùng. Chỉnh bằng biến môi trường PG_POOL_MAX nếu cần.
 * Chỉ import ở phía server.
 */
import { Pool } from "pg";

const globalRef = globalThis as typeof globalThis & { __pgSharedPool__?: Pool };

function poolMax(): number {
  const n = Number.parseInt(process.env.PG_POOL_MAX ?? "", 10);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 10) : 3;
}

export function getSharedPool(connectionString: string): Pool {
  if (!globalRef.__pgSharedPool__) {
    const pool = new Pool({
      connectionString,
      max: poolMax(),
      idleTimeoutMillis: 10_000, // trả kết nối rảnh sau 10 giây
      connectionTimeoutMillis: 15_000, // hết chỗ thì chờ tối đa 15 giây rồi báo lỗi rõ ràng
      allowExitOnIdle: true,
    });
    // Lỗi trên kết nối rảnh (bị bộ gom cắt) không được làm sập tiến trình.
    pool.on("error", (err) => console.warn("[pg] idle client error:", err.message));
    globalRef.__pgSharedPool__ = pool;
  }
  return globalRef.__pgSharedPool__;
}

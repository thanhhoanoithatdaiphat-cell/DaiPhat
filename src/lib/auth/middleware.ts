import { createMiddleware } from "@tanstack/react-start";

/**
 * Middleware cho server function: xác thực người gọi và đưa `userId` vào context.
 * Mọi truy vấn dữ liệu theo người dùng phải lọc bằng `context.userId`.
 */
export const authMiddleware = createMiddleware({ type: "function" }).server(async ({ next }) => {
  // Chỉ import module *.server ở đây để Vite không đưa code server xuống trình duyệt.
  const { assertSameSiteRequest } = await import("./isolation.server");
  const { requireUserId } = await import("./verify.server");
  assertSameSiteRequest();
  const userId = await requireUserId();
  return next({ context: { userId } });
});

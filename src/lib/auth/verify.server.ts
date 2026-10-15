import { getRequest } from "@tanstack/react-start/server";
import { auth } from "./server";

/** Ném khi người gọi chưa đăng nhập (status 401). */
export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
  }
}

export type VerifiedUser = { id: string; email: string | null };

/** Lấy người dùng từ cookie phiên của request hiện tại, hoặc null nếu chưa đăng nhập. */
export async function getSessionUser(): Promise<VerifiedUser | null> {
  const request = getRequest();
  if (!request) return null;
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return null;
  return { id: session.user.id, email: session.user.email ?? null };
}

/** Trả về id người dùng đã xác thực, hoặc ném UnauthorizedError. */
export async function requireUserId(): Promise<string> {
  const user = await getSessionUser();
  if (!user) throw new UnauthorizedError();
  return user.id;
}

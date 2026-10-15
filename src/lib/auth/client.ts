import { createAuthClient } from "better-auth/react";

/** Better Auth client (trình duyệt). Gọi /api/auth/* cùng origin, phiên lưu bằng cookie. */
export const authClient = createAuthClient();

export const authEnabled = true;

export async function signOut(redirectTo = "/"): Promise<void> {
  await authClient.signOut();
  window.location.assign(redirectTo);
}

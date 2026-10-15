import { useState } from "react";
import { signOut } from "./client";
import { useCurrentUser } from "./use-current-user";

/** Chip tên người dùng + nút đăng xuất. Giữ nguyên cấu trúc div > span > span > button vì styles.css dựa vào đó. */
export function UserButton() {
  const user = useCurrentUser();
  const [signingOut, setSigningOut] = useState(false);
  if (!user) return null;
  const label = user.displayName ?? user.primaryEmail ?? "Tài khoản";
  return (
    <div className="flex items-center gap-2">
      <span className="grid h-8 w-8 place-items-center rounded-full bg-black/10 text-sm font-medium">
        {label.charAt(0).toUpperCase()}
      </span>
      <span className="text-sm font-medium">{label}</span>
      <button
        type="button"
        disabled={signingOut}
        onClick={() => {
          setSigningOut(true);
          void signOut().catch(() => setSigningOut(false));
        }}
      >
        {signingOut ? "Đang thoát…" : "Đăng xuất"}
      </button>
    </div>
  );
}

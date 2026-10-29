import { useState, type FormEvent } from "react";
import { Eye, EyeOff } from "lucide-react";
import { errorText, fieldClass, primaryBtn, secondaryBtn } from "@/components/ui";
import { changeMyPassword } from "@/lib/attendance.functions";

/** Ô đặt mật khẩu mới. Đơn giản: một ô, có nút hiện chữ, tối thiểu 4 ký tự. */
export function ChangePasswordForm({ onDone, onSkip, skipLabel = "Để sau" }: { onDone: () => void; onSkip?: () => void; skipLabel?: string }) {
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 4) {
      setError("Mật khẩu cần ít nhất 4 ký tự.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await changeMyPassword({ data: { password } });
      onDone();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block text-sm font-semibold">
        Mật khẩu mới của bạn
        <span className="relative mt-1 block">
          <input
            className={`${fieldClass} pr-14 text-lg`}
            type={show ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={4}
            maxLength={64}
            required
            autoFocus
            placeholder="Ít nhất 4 ký tự"
          />
          <button type="button" className="absolute top-1/2 right-2 grid size-10 -translate-y-1/2 place-items-center text-muted" onClick={() => setShow((v) => !v)} aria-label={show ? "Ẩn mật khẩu" : "Hiện mật khẩu"}>
            {show ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
          </button>
        </span>
      </label>
      <p className="text-xs text-muted">Đặt đơn giản, dễ nhớ là được, ví dụ số điện thoại hoặc ngày sinh. Lần sau đăng nhập bằng số điện thoại và mật khẩu này.</p>
      {error ? <p className="text-sm text-clay">{error}</p> : null}
      <div className={onSkip ? "grid grid-cols-2 gap-2" : ""}>
        {onSkip ? (
          <button type="button" className={secondaryBtn} onClick={onSkip} disabled={busy}>
            {skipLabel}
          </button>
        ) : null}
        <button type="submit" className={`${primaryBtn} ${onSkip ? "" : "w-full"}`} disabled={busy}>
          {busy ? "Đang lưu…" : "Lưu mật khẩu"}
        </button>
      </div>
    </form>
  );
}

/** Hộp hiện ra ngay sau lần đăng nhập đầu tiên bằng mật khẩu do quản trị cấp. */
export function FirstLoginPassword({ onClose }: { onClose: () => void }) {
  const [done, setDone] = useState(false);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="Đặt mật khẩu mới">
      <div className="w-full max-w-sm space-y-3 rounded-2xl border border-edge bg-card p-5 shadow-2xl">
        {done ? (
          <>
            <h2 className="font-display text-2xl font-semibold">Đã đổi mật khẩu</h2>
            <p className="text-sm text-muted">Từ nay hãy đăng nhập bằng mật khẩu mới của bạn.</p>
            <button type="button" className={`${primaryBtn} w-full`} onClick={onClose}>
              Xong
            </button>
          </>
        ) : (
          <>
            <h2 className="font-display text-2xl font-semibold">Chào bạn, hãy đặt mật khẩu của riêng bạn</h2>
            <p className="text-sm text-muted">Mật khẩu hiện tại là mật khẩu công ty cấp. Đặt mật khẩu mới để chỉ mình bạn biết.</p>
            <ChangePasswordForm onDone={() => setDone(true)} onSkip={onClose} />
          </>
        )}
      </div>
    </div>
  );
}

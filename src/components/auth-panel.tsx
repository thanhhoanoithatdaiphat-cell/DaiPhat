import { useState, type FormEvent } from "react";
import { InstallApp } from "@/components/install-app";
import { authClient, authEnabled } from "@/lib/auth/client";
import { errorText, primaryBtn } from "@/components/ui";
import { normalizeVnPhone, phoneLoginEmail } from "@/lib/phone";

const lineField =
  "h-12 w-full border-b border-line bg-transparent text-base text-ink outline-none placeholder:text-muted/50 focus:border-ink";

function mapAuthError(message: string | undefined): string {
  const text = message ?? "";
  if (/already|exist/i.test(text)) return "Số này đã có tài khoản.";
  if (/invalid email or password|invalid credentials/i.test(text)) return "Số hoặc mật khẩu chưa đúng.";
  if (/password/i.test(text) && /short|least|8/i.test(text)) return "Mật khẩu cần ít nhất 4 ký tự.";
  if (/origin/i.test(text)) return "Không vào được từ trang này.";
  if (/too many/i.test(text)) return "Nhập sai quá nhiều lần. Hãy xin mã mới.";
  if (/expired/i.test(text)) return "Mã đã hết hạn. Hãy xin mã mới.";
  if (/otp|code/i.test(text)) return "Mã chưa đúng.";
  return text || "Không vào được.";
}

export function AuthPanel() {
  const [mode, setMode] = useState<"in" | "up" | "reset">("in");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState("");
  const [name, setName] = useState("");
  const [invite, setInvite] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const normalized = normalizeVnPhone(phone);
    if (!normalized) {
      setError("Số điện thoại chưa đúng.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "reset") {
        if (step === "phone") {
          const sent = await authClient.$fetch("/phone-number/request-password-reset", {
            method: "POST",
            body: { phoneNumber: normalized },
          });
          if (sent.error) throw new Error(sent.error.message);
          setStep("code");
          setNotice("Nếu số này đã có tài khoản, mã 6 số sẽ được gửi qua SMS.");
          setBusy(false);
          return;
        }
        const done = await authClient.$fetch("/phone-number/reset-password", {
          method: "POST",
          body: { phoneNumber: normalized, otp: code.trim(), newPassword: password },
        });
        if (done.error) {
          setError(mapAuthError(done.error.message));
          setBusy(false);
          return;
        }
        setMode("in");
        setStep("phone");
        setCode("");
        setPassword("");
        setNotice("Đã đổi mật khẩu. Hãy đăng nhập.");
        setBusy(false);
        return;
      }
      const email = phoneLoginEmail(normalized);
      const result =
        mode === "up"
          ? await authClient.signUp.email({
              email,
              password,
              name: name.trim(),
              callbackURL: "/",
              inviteCode: invite,
            } as Parameters<typeof authClient.signUp.email>[0])
          : await authClient.signIn.email({
              email,
              password,
              callbackURL: "/",
              rememberMe: true,
            });
      if (result.error) {
        setError(mapAuthError(result.error.message));
        setBusy(false);
        return;
      }
      window.location.assign("/");
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  if (!authEnabled) {
    return <p className="text-sm text-muted">Đăng nhập đang tắt.</p>;
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex gap-6 border-b border-line">
        <ModeButton active={mode === "in"} onClick={() => { setMode("in"); setError(""); setNotice(""); }}>
          Đăng nhập
        </ModeButton>
        <ModeButton active={mode === "up"} onClick={() => { setMode("up"); setError(""); setNotice(""); }}>
          Tạo tài khoản
        </ModeButton>
      </div>
      <form className="mt-7 flex flex-1 flex-col gap-5" onSubmit={onSubmit}>
        {mode === "up" ? (
          <label className="block">
            <span className="text-sm font-semibold text-muted">Họ tên</span>
            <input className={lineField} value={name} onChange={(e) => setName(e.target.value)} required minLength={2} autoComplete="name" />
          </label>
        ) : null}
        {mode === "up" ? (
          <label className="block">
            <span className="text-sm font-semibold text-muted">Mã mời của công ty</span>
            <input
              className={`${lineField} font-display text-2xl tracking-widest uppercase`}
              value={invite}
              onChange={(e) => setInvite(e.target.value)}
              placeholder="ABCD-EFGH"
              autoComplete="off"
              autoCapitalize="characters"
            />
            <span className="text-xs text-muted">Hỏi quản trị để lấy mã. Người đầu tiên lập hệ thống có thể để trống.</span>
          </label>
        ) : null}
        <label className="block">
          <span className="text-sm font-semibold text-muted">Số điện thoại</span>
          <input
            className={lineField}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="0900 000 000"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />
        </label>
        {mode === "reset" && step === "code" ? (
          <label className="block">
            <span className="text-sm font-semibold text-muted">Mã 6 số trong SMS</span>
            <input
              className={lineField}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              required
            />
          </label>
        ) : null}
        {mode !== "reset" || step === "code" ? (
          <label className="block">
            <span className="text-sm font-semibold text-muted">{mode === "reset" ? "Mật khẩu mới" : "Mật khẩu"}</span>
            <input
              className={lineField}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={4}
              autoComplete={mode === "in" ? "current-password" : "new-password"}
            />
          </label>
        ) : null}
        {mode === "in" ? (
          <button type="button" className="self-start text-sm font-semibold text-ink underline" onClick={() => { setMode("reset"); setStep("phone"); setError(""); setNotice(""); }}>
            Quên mật khẩu?
          </button>
        ) : null}
        {mode === "reset" ? (
          <button type="button" className="self-start text-sm text-muted underline" onClick={() => { setMode("in"); setStep("phone"); setError(""); setNotice(""); }}>
            Quay lại đăng nhập
          </button>
        ) : null}
        {notice ? <p className="text-sm text-ok">{notice}</p> : null}
        {error ? <p className="text-sm text-clay">{error}</p> : null}
        <button
          className={`${primaryBtn} mt-auto w-full`}
          type="submit"
          disabled={busy}
        >
          {busy ? "Đang xử lý…" : mode === "up" ? "Tạo tài khoản" : mode === "reset" ? (step === "phone" ? "Gửi mã qua SMS" : "Đặt lại mật khẩu") : "VÀO CA"}
        </button>
      </form>
      <div className="mt-4">
        <InstallApp />
      </div>
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px h-11 border-b-2 text-sm ${active ? "border-ink font-medium text-ink" : "border-transparent text-muted"}`}
    >
      {children}
    </button>
  );
}

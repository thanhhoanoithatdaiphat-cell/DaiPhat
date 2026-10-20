import { useEffect, useState } from "react";
import { Copy, RefreshCw } from "lucide-react";
import { errorText } from "@/components/ui";
import { getInviteCode, regenerateInviteCode } from "@/lib/attendance.functions";

/** Mã mời công ty: nhân viên nhập mã này khi đăng ký. Chỉ quản trị thấy. */
export function InviteCodeCard() {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getInviteCode()
      .then((r) => setCode(r.code))
      .catch((err) => setError(errorText(err)));
  }, []);

  async function renew() {
    if (!window.confirm("Tạo mã mới? Mã cũ sẽ không dùng để đăng ký được nữa. Tài khoản đã tạo không bị ảnh hưởng.")) return;
    setBusy(true);
    try {
      setCode((await regenerateInviteCode()).code);
      setError("");
    } catch (err) {
      setError(errorText(err));
    }
    setBusy(false);
  }

  return (
    <section className="space-y-3 rounded-xl border border-edge bg-card p-4">
      <h2 className="font-display text-2xl font-semibold">Mã mời nhân viên</h2>
      <p className="text-sm text-muted">Gửi mã này cho nhân viên mới. Họ nhập mã khi tạo tài khoản. Lộ mã thì tạo mã mới.</p>
      <div className="flex items-center gap-3">
        <p className="font-display text-4xl leading-none font-bold tracking-wider whitespace-nowrap">{code || "…"}</p>
        <button
          type="button"
          disabled={!code}
          aria-label="Sao chép mã"
          className="grid size-10 place-items-center rounded-md border border-edge"
          onClick={() => {
            void navigator.clipboard?.writeText(code).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          <Copy className="size-4" />
        </button>
        {copied ? <span className="text-sm text-ok">Đã chép</span> : null}
      </div>
      {error ? <p className="text-sm text-clay">{error}</p> : null}
      <button type="button" disabled={busy} className="flex items-center gap-2 text-sm font-semibold underline" onClick={() => void renew()}>
        <RefreshCw className="size-4" /> Tạo mã mới
      </button>
    </section>
  );
}

import { useEffect, useState } from "react";
import { fieldClass } from "@/components/ui";

/** "730" | "7:30" | "1730" | "17" -> "HH:MM", hoặc "" nếu chưa hợp lệ. */
function normalize(text: string): string {
  const d = text.replace(/\D/g, "").slice(0, 4);
  if (!d) return "";
  const h = d.length <= 2 ? Number(d) : Number(d.slice(0, -2));
  const m = d.length <= 2 ? 0 : Number(d.slice(-2));
  if (h > 23 || m > 59) return "";
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Hiện số đang gõ kèm dấu hai chấm tự động: 730 -> 7:30. */
function mask(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 4);
  return d.length > 2 ? `${d.slice(0, -2)}:${d.slice(-2)}` : d;
}

/** Ô nhập giờ bằng bàn phím số (bàn phím số tự bật trên điện thoại). Giá trị trả ra luôn dạng "HH:MM". */
export function TimeField({
  value,
  onChange,
  required,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  label?: string;
}) {
  const [text, setText] = useState(value);
  useEffect(() => {
    if (value !== normalize(text)) setText(value);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <input
      className={`${fieldClass} text-center font-display text-xl tabular-nums`}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder="07:30"
      maxLength={5}
      pattern="([01][0-9]|2[0-3]):[0-5][0-9]"
      title="Nhập giờ dạng 07:30 (chỉ cần gõ 730)"
      aria-label={label}
      required={required}
      value={text}
      onFocus={(e) => e.target.select()}
      onChange={(e) => {
        const shown = mask(e.target.value);
        setText(shown);
        onChange(normalize(shown));
      }}
      onBlur={() => {
        const n = normalize(text);
        setText(n);
        onChange(n);
      }}
    />
  );
}

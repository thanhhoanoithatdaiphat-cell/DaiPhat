import { useEffect } from "react";

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function messageFor(el: Field): string {
  const v = el.validity;
  const type = el instanceof HTMLInputElement ? el.type : el instanceof HTMLSelectElement ? "select" : "textarea";
  if (v.valueMissing) {
    if (type === "checkbox" || type === "radio") return "Vui lòng đánh dấu ô này.";
    if (type === "select") return "Vui lòng chọn một mục.";
    if (type === "file") return "Vui lòng chọn một tệp.";
    return "Vui lòng điền thông tin này.";
  }
  if (v.tooShort) return `Cần nhập ít nhất ${(el as HTMLInputElement).minLength} ký tự.`;
  if (v.tooLong) return `Chỉ được nhập tối đa ${(el as HTMLInputElement).maxLength} ký tự.`;
  if (v.typeMismatch) return type === "email" ? "Email chưa đúng định dạng." : type === "url" ? "Đường dẫn chưa đúng định dạng." : "Giá trị chưa đúng định dạng.";
  if (v.patternMismatch) return (el as HTMLInputElement).title || "Giá trị chưa đúng định dạng.";
  if (v.rangeUnderflow) return `Giá trị phải từ ${(el as HTMLInputElement).min} trở lên.`;
  if (v.rangeOverflow) return `Giá trị phải từ ${(el as HTMLInputElement).max} trở xuống.`;
  if (v.stepMismatch) return "Giá trị chưa hợp lệ.";
  if (v.badInput) return "Giá trị nhập vào chưa đúng.";
  return "Giá trị chưa hợp lệ.";
}

/** Đổi thông báo kiểm tra biểu mẫu của trình duyệt ("Please fill out this field.") sang tiếng Việt cho mọi ô nhập. */
export function VnValidation() {
  useEffect(() => {
    const onInvalid = (e: Event) => {
      const el = e.target as Field;
      if (!el || typeof el.setCustomValidity !== "function") return;
      el.setCustomValidity("");
      el.setCustomValidity(messageFor(el));
    };
    const onEdit = (e: Event) => {
      const el = e.target as Field;
      if (el && typeof el.setCustomValidity === "function") el.setCustomValidity("");
    };
    document.addEventListener("invalid", onInvalid, true);
    document.addEventListener("input", onEdit, true);
    document.addEventListener("change", onEdit, true);
    return () => {
      document.removeEventListener("invalid", onInvalid, true);
      document.removeEventListener("input", onEdit, true);
      document.removeEventListener("change", onEdit, true);
    };
  }, []);
  return null;
}

/** Tải file CSV về máy. Thêm BOM để Excel đọc đúng tiếng Việt; gắn link vào trang và chờ trước khi thu hồi để trình duyệt (Firefox, Safari, Edge, Chrome trên điện thoại) kịp bắt đầu tải. */
export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv.startsWith("\ufeff") ? "" : "\ufeff", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(url);
  }, 10_000);
}

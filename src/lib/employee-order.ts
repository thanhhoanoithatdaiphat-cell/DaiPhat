/** Xếp theo mã nhân viên theo số thứ tự (NV2 trước NV10); người chưa có mã xuống cuối, rồi theo tên. */
export function compareByCode(
  a: { employeeCode?: string | null; fullName: string },
  b: { employeeCode?: string | null; fullName: string },
): number {
  const ca = (a.employeeCode ?? "").trim();
  const cb = (b.employeeCode ?? "").trim();
  if (ca && !cb) return -1;
  if (!ca && cb) return 1;
  if (ca && cb) {
    const byCode = ca.localeCompare(cb, "vi", { numeric: true, sensitivity: "base" });
    if (byCode) return byCode;
  }
  return a.fullName.localeCompare(b.fullName, "vi");
}

export const fieldClass =
  "h-12 w-full rounded-md border border-edge bg-card px-4 text-base text-ink outline-none focus-visible:ring-4 focus-visible:ring-ice";

export const primaryBtn = "btn-3d btn-3d-primary disabled:cursor-not-allowed";

export const secondaryBtn = "btn-3d btn-3d-secondary disabled:cursor-not-allowed";

export function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return "Có lỗi, thử lại.";
}

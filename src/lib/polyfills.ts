/**
 * Bù các hàm trình duyệt mà iPhone đời cũ (iOS 12–15) còn thiếu. Chỉ thêm khi chưa có,
 * nên trên máy mới file này không làm gì. Phải được nạp đầu tiên (xem routes/__root.tsx).
 */
const root: any = typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {};

if (typeof (root as any).globalThis === "undefined") root.globalThis = root;

if (typeof Object.hasOwn !== "function") {
  (Object as any).hasOwn = (obj: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(obj, key);
}

if (typeof Object.fromEntries !== "function") {
  (Object as any).fromEntries = (entries: Iterable<[PropertyKey, unknown]>) => {
    const out: Record<PropertyKey, unknown> = {};
    for (const [k, v] of entries) out[k as string] = v;
    return out;
  };
}

if (!(String.prototype as any).replaceAll) {
  (String.prototype as any).replaceAll = function (this: string, search: string | RegExp, replacement: any) {
    if (search instanceof RegExp) {
      if (!search.global) throw new TypeError("replaceAll must be called with a global RegExp");
      return this.replace(search, replacement);
    }
    return this.split(String(search)).join(typeof replacement === "function" ? replacement(String(search)) : String(replacement));
  };
}

function atPolyfill(this: ArrayLike<unknown> | string, index: number) {
  const n = Math.trunc(index) || 0;
  const i = n < 0 ? this.length + n : n;
  return i < 0 || i >= this.length ? undefined : (this as any)[i];
}
if (!(Array.prototype as any).at) Object.defineProperty(Array.prototype, "at", { value: atPolyfill, writable: true, configurable: true });
if (!(String.prototype as any).at) Object.defineProperty(String.prototype, "at", { value: atPolyfill, writable: true, configurable: true });

if (typeof (Promise as any).allSettled !== "function") {
  (Promise as any).allSettled = (items: Iterable<unknown>) =>
    Promise.all(
      Array.from(items).map((item) =>
        Promise.resolve(item).then(
          (value) => ({ status: "fulfilled", value }),
          (reason) => ({ status: "rejected", reason }),
        ),
      ),
    );
}

if (typeof (root as any).queueMicrotask !== "function") {
  root.queueMicrotask = (fn: () => void) => {
    Promise.resolve().then(fn);
  };
}

if (typeof crypto !== "undefined" && typeof (crypto as any).randomUUID !== "function" && typeof crypto.getRandomValues === "function") {
  (crypto as any).randomUUID = () => {
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };
}

export {};

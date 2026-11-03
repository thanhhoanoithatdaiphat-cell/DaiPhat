// Cấu hình PostCSS để iPhone đời cũ hiển thị được app.
import cascadeLayers from "@csstools/postcss-cascade-layers";

/**
 * Safari/iOS dưới 15.4 không hiểu đơn vị dvh/svh/lvh: dòng khai báo bị bỏ, màn hình mất chiều cao.
 * Plugin này chèn thêm một dòng bản vh ngay trước; máy mới vẫn dùng dvh (dòng sau thắng).
 */
const viewportUnitFallback = () => ({
  postcssPlugin: "viewport-unit-fallback",
  Declaration(decl) {
    if (!/[\d.](dvh|svh|lvh)\b/.test(decl.value)) return;
    const prev = decl.prev();
    const fallback = decl.value.replace(/([\d.])(dvh|svh|lvh)\b/g, "$1vh");
    if (prev && prev.type === "decl" && prev.prop === decl.prop && prev.value === fallback) return;
    decl.cloneBefore({ value: fallback });
  },
});
viewportUnitFallback.postcss = true;

// Safari/iOS dưới 15.4 không hiểu @layer (Tailwind v4 dùng @layer cho toàn bộ kiểu chữ),
// nên bỏ qua hết CSS và trang hiện không có định dạng. Plugin này đổi @layer thành quy tắc thường
// có độ ưu tiên tương đương.
export default {
  plugins: [viewportUnitFallback(), cascadeLayers()],
};

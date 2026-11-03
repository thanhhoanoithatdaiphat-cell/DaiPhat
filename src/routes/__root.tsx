import "@/lib/polyfills";
import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import appCss from "../styles.css?url";
import { VnValidation } from "@/components/vn-validation";
import { AppReady } from "@/components/app-ready";

const APP_NAME = "Vào Ca";

// Tập lệnh viết bằng cú pháp cũ (ES5) để chạy được cả trên máy mà phần còn lại của app không chạy nổi.
// Nếu app lỗi cú pháp hoặc quá 15 giây vẫn chưa chạy, hiện hướng dẫn thay vì để trang trắng.
const OLD_BROWSER_SCRIPT = `(function(){
var shown=false;
function show(){
if(shown||document.documentElement.getAttribute('data-app-ready'))return;
shown=true;
var d=document.createElement('div');
d.id='vaoca-old-browser';
d.setAttribute('style','position:fixed;left:0;right:0;top:0;bottom:0;z-index:2147483647;background:#1c130c;color:#fff3d6;font:16px/1.6 -apple-system,Helvetica,Arial,sans-serif;padding:24px;overflow:auto;box-sizing:border-box');
var ua=(navigator.userAgent||'').replace(/[<>&]/g,'');
d.innerHTML='<h2 style="margin:0 0 12px;color:#fcb300;font-size:22px">Chưa mở được Vào Ca trên máy này</h2>'
+'<p style="margin:0 0 12px">Có thể điện thoại đang dùng phần mềm quá cũ. Bạn thử lần lượt:</p>'
+'<ol style="margin:0 0 16px;padding-left:20px"><li>Cập nhật iPhone: Cài đặt → Cài đặt chung → Cập nhật phần mềm.</li>'
+'<li>Mở lại bằng Safari (hoặc Chrome bản mới nhất), không mở trong Zalo/Facebook.</li>'
+'<li>Vẫn không được: báo quản trị để chấm công bằng máy khác hoặc gửi đơn sửa công.</li></ol>'
+'<button onclick="location.reload()" style="font:inherit;font-weight:600;padding:12px 20px;border:0;border-radius:12px;background:#fcb300;color:#1c130c">Tải lại</button>'
+'<p style="margin:20px 0 0;font-size:11px;opacity:.6;word-break:break-all">'+ua+'</p>';
(document.body||document.documentElement).appendChild(d);
}
window.addEventListener('error',function(e){
var m=(e&&e.message)||'';
if(/SyntaxError|Unexpected (token|identifier|keyword)|Can't find variable/.test(m))show();
},true);
window.addEventListener('load',function(){setTimeout(show,15000);});
})();`;


export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: APP_NAME },
      { name: "theme-color", content: "#e9e7e0" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "mobile-web-app-capable", content: "yes" },
    ],
    scripts: [{ children: OLD_BROWSER_SCRIPT }],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/icon-180.png" },
    ],
  }),
  component: () => (
    <html lang="vi" className="antialiased" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <VnValidation />
        <AppReady />
        <Outlet />
        <Scripts />
      </body>
    </html>
  ),
});

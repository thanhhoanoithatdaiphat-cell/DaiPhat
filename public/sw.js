// Service worker tối giản: giúp Chrome cho phép cài ứng dụng. Không lưu đệm để luôn có bản mới nhất.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});

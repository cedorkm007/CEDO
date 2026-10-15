/* push-sw.js — shows the web-push notifications of the CEDO portal (scholar and staff). It only handles push; it caches nothing and never
   touches page requests, so it cannot change how the site loads. The Kauban app has its own service worker (kauban-sw.js, scope /kauban). */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

self.addEventListener("push", event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data ? event.data.text() : "" }; }
  const title = data.title || "CEDO";
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || "",
    icon: "/push-icon.png",
    badge: "/push-icon.png",
    data: { url: typeof data.url === "string" && data.url.charAt(0) === "/" ? data.url : "/" },
  }));
});

// Tapping the notification opens (or focuses) the portal at the page it is about.
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(windows => {
    for (const w of windows) {
      if (w.url.indexOf(self.location.origin) === 0 && "focus" in w) {
        return w.focus().then(f => ("navigate" in f ? f.navigate(target) : f));
      }
    }
    return self.clients.openWindow(target);
  }));
});

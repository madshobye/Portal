self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  event.waitUntil(handlePush());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    if (clients.length > 0) {
      return clients[0].focus();
    }
    return self.clients.openWindow("./");
  }));
});

async function handlePush() {
  const message = {
    title: "Web Push Trigger",
    text: `Push event at ${new Date().toLocaleTimeString()}`,
  };

  const clientList = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });

  for (const client of clientList) {
    client.postMessage({
      type: "push-trigger",
      text: message.text,
    });
  }

  return self.registration.showNotification(message.title || "Web Notification", {
    body: message.text || "",
    tag: "portal-webnotifications",
  });
}

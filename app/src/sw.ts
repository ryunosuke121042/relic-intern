/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core'
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

declare let self: ServiceWorkerGlobalScope

self.skipWaiting()
clientsClaim()
cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')))

// サーバーから届いた通知を表示する
self.addEventListener('push', (event) => {
  const data = (() => {
    try {
      return event.data?.json() ?? {}
    } catch {
      return { body: event.data?.text() }
    }
  })() as { title?: string; body?: string; url?: string }

  event.waitUntil(
    self.registration.showNotification(data.title ?? '目標達成アプリ', {
      body: data.body ?? '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url ?? '/replan' },
    }),
  )
})

// 通知をタップしたら /replan を開く
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data as { url?: string } | undefined)?.url ?? '/replan'
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of clients) {
        if ('focus' in client) {
          await client.navigate(url)
          return client.focus()
        }
      }
      return self.clients.openWindow(url)
    })(),
  )
})

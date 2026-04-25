"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";

export default function PushSetup() {
  const { data: session, status } = useSession();

  useEffect(() => {
    if (status !== "authenticated" || !session) return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    if (Notification.permission !== "granted") return;

    const subscribe = async () => {
      try {
        const meRes = await fetch("/api/users/me");
        const me = await meRes.json();
        if (!me.pushNotificationLevel || me.pushNotificationLevel === "NONE") return;

        const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
        if (!vapidKey) return;

        const reg = await navigator.serviceWorker.ready;
        const existing = await reg.pushManager.getSubscription();

        // Already subscribed — ensure it's saved server-side
        const sub = existing ?? await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: vapidKey,
        });

        await fetch("/api/notifications/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sub.toJSON()),
        });
      } catch {
        // SW not ready or push not available — silently ignore
      }
    };

    subscribe();
  }, [session, status]);

  return null;
}

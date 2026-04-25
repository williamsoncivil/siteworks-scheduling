import webpush from "web-push";
import { prisma } from "@/lib/prisma";

const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY ?? "";
const vapidEmail = process.env.VAPID_EMAIL ?? "mailto:admin@example.com";

if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(vapidEmail, vapidPublicKey, vapidPrivateKey);
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

export async function sendPushNotification(userId: string, payload: PushPayload) {
  if (!vapidPublicKey || !vapidPrivateKey) return;

  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId },
  });

  const sends = subscriptions.map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload)
      );
    } catch (err: unknown) {
      if (err && typeof err === "object" && "statusCode" in err) {
        const statusCode = (err as { statusCode: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
        }
      }
    }
  });

  await Promise.allSettled(sends);
}

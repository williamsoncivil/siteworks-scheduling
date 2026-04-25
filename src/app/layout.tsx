"use client";

import "./globals.css";
import { SessionProvider } from "next-auth/react";
import PushSetup from "@/components/PushSetup";
import { SocketProvider } from "@/context/SocketContext";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#2563eb" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="SiteWorks" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
      </head>
      <body>
        <SessionProvider>
          <SocketProvider>
            <PushSetup />
            {children}
          </SocketProvider>
        </SessionProvider>
      </body>
    </html>
  );
}

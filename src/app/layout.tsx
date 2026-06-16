import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";

export const metadata: Metadata = {
  title: {
    default: "NexusRTC — Instant Video Calls",
    template: "%s · NexusRTC",
  },
  description:
    "Peer-to-peer video calls in your browser. No sign-up, password-protected rooms, live chat, screen share, and recording.",
  keywords: ["video call", "webrtc", "peer-to-peer", "conference", "nexusrtc"],
  authors: [{ name: "NexusRTC" }],
  openGraph: {
    title: "NexusRTC — Instant Video Calls",
    description: "Create a room, share one link, talk face-to-face in seconds.",
    type: "website",
    siteName: "NexusRTC",
  },
  icons: {
    icon: "/favicon.svg",
    apple: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,400;0,500;0,600;0,700;0,800;1,400&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}

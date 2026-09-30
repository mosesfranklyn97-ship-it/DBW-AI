import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import type { ReactNode } from "react";
import InstallPrompt from "@/components/InstallPrompt";
import ServiceWorkerRegistration from "@/components/ServiceWorkerRegistration";
import UpdatePrompt from "@/components/UpdatePrompt";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "DBW AI — Text & Voice to Database",
  description:
    "Describe your app in plain English or Krio. DBW AI designs the full SQL database, sample data and ER diagram — download and open in phpMyAdmin, MySQL Workbench, pgAdmin or Supabase.",
  applicationName: "DBW AI",
  manifest: "/manifest.webmanifest",
  keywords: [
    "text to SQL",
    "AI database generator",
    "ER diagram",
    "MySQL",
    "PostgreSQL",
    "SQLite",
    "Supabase",
  ],
  appleWebApp: {
    capable: true,
    title: "DBW AI",
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
    date: false,
    address: false,
    email: false,
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "16x16 32x32 48x48" },
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  other: {
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "default",
    "apple-mobile-web-app-title": "DBW AI",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#ffffff" },
  ],
  // Light-only app. Emitting the meta tag is what keeps an OS in dark mode from
  // inverting scrollbars, form controls and the caret on an otherwise white UI.
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
  minimumScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      {/* No <head> here on purpose. This app ships no apple-touch-startup-image
          links: an installed DBW AI used to open on a static branded splash
          with its own background, which meant a hard cut to the real UI. iOS
          falls back to a plain white launch field, and that is the same colour
          as `background_color` in the manifest and the first React paint, so
          the hand-off is invisible and no launch images ship at all. */}
      <body className={`${inter.variable} ${jetbrains.variable} antialiased`}>
        {children}
        <InstallPrompt />
        <UpdatePrompt />
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}

import type { Metadata } from "next"
import Script from "next/script"
import { Inter, Geist_Mono } from "next/font/google"

import { Analytics } from "@vercel/analytics/next"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/toaster"
import { ServiceWorkerRegister } from "@/components/pwa/register-sw"
import { NetworkStatus } from "@/components/pwa/network-status"
import { SyncStatus } from "@/components/pwa/sync-status"
import "./globals.css"

const inter = Inter({
  subsets: ["latin", "latin-ext"],
  variable: "--font-inter",
  display: "swap",
  weight: ["300", "400", "500", "600", "700"],
})

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono-geist",
  display: "swap",
  weight: ["400", "500", "600", "700"],
})

export const metadata: Metadata = {
  title: "Sesigo Data Portal",
  description:
    "Sesigo Data Portal — enterprise data management for health indicators, projects, and analytics. Powered by BONASO.",
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-icon.png",
  },
}

const isVercelDeployment = process.env.VERCEL === "1"
const enableSwInDev = process.env.NEXT_PUBLIC_ENABLE_SW === "true"
const disableSwInDev = process.env.NODE_ENV !== "production" && !enableSwInDev

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <body className="font-sans antialiased">
        {disableSwInDev ? (
          <Script id="disable-dev-sw" strategy="beforeInteractive">
            {`
              try {
                if ('serviceWorker' in navigator) {
                  navigator.serviceWorker.getRegistrations().then(function (registrations) {
                    registrations.forEach(function (registration) { registration.unregister(); });
                  });
                }
                if ('caches' in window) {
                  caches.keys().then(function (keys) {
                    keys.forEach(function (key) {
                      if (key.indexOf('bonaso-') === 0 || key.indexOf('sesigo-') === 0) { caches.delete(key); }
                    });
                  });
                }
              } catch (e) {}
            `}
          </Script>
        ) : null}
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <ServiceWorkerRegister />
          <NetworkStatus />
          <SyncStatus />
          {children}
          <Toaster />
          {isVercelDeployment ? <Analytics debug={false} /> : null}
        </ThemeProvider>
      </body>
    </html>
  )
}

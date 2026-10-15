import type { Metadata, Viewport } from "next";
import "@fontsource/barlow/400.css";
import "@fontsource/barlow/500.css";
import "@fontsource/barlow/600.css";
import "@fontsource/barlow/700.css";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/barlow-condensed/700.css";
import "@fontsource/barlow-condensed/800.css";
import "@fontsource/barlow-condensed/800-italic.css";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";
import { MotionProvider } from "@/components/fx/motion";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";

export const metadata: Metadata = { title: { default: APP_NAME, template: `%s · ${APP_NAME}` }, description: APP_TAGLINE };
export const viewport: Viewport = { themeColor: "#07090b", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-PT">
      <body className="min-h-dvh">
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";
import "@fontsource-variable/archivo/standard.css";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";
import { MotionProvider } from "@/components/fx/motion";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";
import { PREFS_BOOT_SCRIPT, THEME_COLORS } from "@/lib/prefs";

export const metadata: Metadata = { title: { default: APP_NAME, template: `%s · ${APP_NAME}` }, description: APP_TAGLINE };
export const viewport: Viewport = { themeColor: THEME_COLORS.dark, width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // data-theme/data-motion are set before paint by the boot script; without them :root is the dark theme. The
    // server never renders them, so React can't reset a light choice on re-render.
    <html lang="pt-PT" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: PREFS_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-dvh">
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  );
}

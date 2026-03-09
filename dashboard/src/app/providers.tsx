"use client";

import { SidebarProvider } from "@/components/Layouts/sidebar/sidebar-context";
import { MsalRedirectHandler } from "@/components/Auth/msal-redirect-handler";
import { ThemeProvider } from "next-themes";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider defaultTheme="light" attribute="class">
      <MsalRedirectHandler />
      <SidebarProvider>{children}</SidebarProvider>
    </ThemeProvider>
  );
}

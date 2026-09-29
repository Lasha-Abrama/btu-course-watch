import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { AuthSessionProvider } from "../components/auth-session";

export const metadata: Metadata = {
  title: "BTU Course Watch",
  description:
    "Your BTU Course Watch account. Course availability monitoring is on its way.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AuthSessionProvider>{children}</AuthSessionProvider>
      </body>
    </html>
  );
}

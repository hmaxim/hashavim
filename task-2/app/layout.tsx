import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Team Task Board",
  description: "Shared-state team task board with optimistic updates and SSE",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

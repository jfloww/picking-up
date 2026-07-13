import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Picking Up",
  description: "A practical task workspace for web first and iPhone later.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

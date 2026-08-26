import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Brick Tree — Cut down complex ideas and build up new ones",
  description:
    "Use Tree to break an idea into clearer parts or Brick to build from what you already know toward what comes next.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

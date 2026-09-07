import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

// Branding is configurable so a fork can present its own assistant. Override
// with ASSISTANT_NAME / ASSISTANT_TAGLINE in .env.
export function generateMetadata(): Metadata {
  const name = process.env.ASSISTANT_NAME ?? "Frontdesk AI";
  const tagline =
    process.env.ASSISTANT_TAGLINE ??
    "Personal AI assistant - schedules meetings, sends messages, and answers questions.";
  return {
    title: name,
    description: tagline,
  };
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>{children}</body>
    </html>
  );
}

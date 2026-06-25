import type { Metadata } from "next";
import { Instrument_Sans } from "next/font/google";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: "Loupe",
  description: "AI agents for designers",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${instrumentSans.variable} ${GeistMono.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}

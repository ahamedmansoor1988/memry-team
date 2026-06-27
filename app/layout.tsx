import type { Metadata } from "next";
import { Instrument_Serif, DM_Sans } from "next/font/google";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "500", "600", "700"],
});

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  variable: "--font-serif",
  weight: "400",
  style: ["normal", "italic"],
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
      <body className={`${dmSans.variable} ${instrumentSerif.variable} ${GeistMono.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}


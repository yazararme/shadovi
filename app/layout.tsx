import type { Metadata } from "next";
import { Figtree, Cormorant_Garamond, DM_Mono, Playfair_Display, Exo_2 } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

const figtree = Figtree({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["300", "400", "500", "600", "700", "800"],
});

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  variable: "--font-serif",
  weight: ["400", "500", "600", "700"],
});

const dmMono = DM_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500"],
});

const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair",
  weight: ["400", "500", "600", "700"],
});

const exo2 = Exo_2({
  subsets: ["latin"],
  variable: "--font-exo2",
  weight: ["900"],
});

export const metadata: Metadata = {
  title: "Shadovi — AEO Intelligence Platform",
  description: "Track your brand's visibility across AI models.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        className={`${figtree.variable} ${cormorant.variable} ${dmMono.variable} ${playfair.variable} ${exo2.variable} ${figtree.className}`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}

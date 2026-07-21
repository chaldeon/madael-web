import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { LanguageProvider } from "@/context/LanguageContext";
import SiteChrome from "@/components/SiteChrome";
import { GoogleAnalytics } from "@next/third-parties/google";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  metadataBase: new URL('https://madael.id'),
  title: {
    default: "Madael Consult — HR & Legal Consulting Indonesia",
    template: "%s | Madael Consult",
  },
  description:
    "Madael Consult membantu perusahaan lokal dan asing mengelola SDM, kepatuhan hukum, dan operasional HR secara efektif di Indonesia.",
  openGraph: {
    type: "website",
    locale: "id_ID",
    siteName: "Madael Consult",
    title: "Madael Consult — HR & Legal Consulting Indonesia",
    description:
      "Madael Consult membantu perusahaan lokal dan asing mengelola SDM, kepatuhan hukum, dan operasional HR secara efektif di Indonesia.",
    images: [{ url: "/logos/madael_logo.jpg", width: 200, height: 170, alt: "Madael Consult" }],
  },
  twitter: {
    card: "summary",
    title: "Madael Consult — HR & Legal Consulting Indonesia",
    description:
      "Madael Consult membantu perusahaan lokal dan asing mengelola SDM, kepatuhan hukum, dan operasional HR secara efektif di Indonesia.",
    images: ["/logos/madael_logo.jpg"],
  },
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="id"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <LanguageProvider>
          <SiteChrome>{children}</SiteChrome>
        </LanguageProvider>
        <GoogleAnalytics gaId={process.env.NEXT_PUBLIC_GA_ID} />
      </body>
    </html>
  );
}
import type { Metadata } from "next";
import localFont from "next/font/local";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "./lib/auth-context";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

const inter = Inter({
  subsets: ["latin", "cyrillic"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "CaseTrainer — тренажёр продуктовых кейсов",
  description: "Практикуй структурное мышление с AI-обратной связью",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${inter.variable} antialiased font-inter`}
      >
        <AuthProvider>
          {children}
          <a
            href="mailto:distrayoung@yandex.ru?subject=Фидбек CaseTrainer"
            title="Написать фидбек"
            className="fixed bottom-4 left-4 z-50 flex items-center gap-2 bg-white border border-gray-200 shadow-md hover:shadow-lg text-gray-600 hover:text-indigo-600 text-xs font-medium px-3 py-2 rounded-full transition-all"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            Обратная связь
          </a>
        </AuthProvider>
      </body>
    </html>
  );
}

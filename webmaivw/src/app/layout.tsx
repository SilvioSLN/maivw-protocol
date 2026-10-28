import { serializeRuntimePublicConfig } from "@/lib/runtime-public-config";
export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import "./globals.css";

export const metadata: Metadata = {
  title: "WebMaivw — E-mail Seguro para Empresas",
  description: "Envie e receba e-mails com proteção contra fraudes e verificação de identidade.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className="dark">
      <head><script id="maivw-public-config" dangerouslySetInnerHTML={{ __html: serializeRuntimePublicConfig() }} /></head>
      <body className="antialiased bg-slate-50 text-slate-900 dark:bg-[#090d16] dark:text-[#f8fafc] transition-colors duration-200">
        <ThemeProvider>
          <AuthProvider>
            {children}
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { MobileCta } from "@/components/ui/mobile-cta";
import { ToastProvider } from "@/components/ui/toast";
import "./globals.css";

export const metadata: Metadata = {
  title: "ALFA Barber | Agendamento Online",
  description: "Barbearia premium com agendamento online por servico, barbeiro e horario.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className="bg-zinc-950 text-zinc-100 antialiased">
        <ToastProvider>
          {children}
          <MobileCta />
        </ToastProvider>
      </body>
    </html>
  );
}


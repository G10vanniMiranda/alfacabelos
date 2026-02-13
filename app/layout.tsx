import type { Metadata } from "next";
import { MobileCta } from "@/components/ui/mobile-cta";
import { ToastProvider } from "@/components/ui/toast";
import { getCurrentClient } from "@/lib/actions/client-auth-actions";
import "./globals.css";

export const metadata: Metadata = {
  title: "ALFA Barber | Agendamento Online",
  description: "Barbearia premium com agendamento online por serviço, barbeiro e horário.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const client = await getCurrentClient();

  return (
    <html lang="pt-BR">
      <body className="bg-zinc-950 text-zinc-100 antialiased">
        <ToastProvider>
          {children}
          <MobileCta isLoggedIn={Boolean(client)} />
        </ToastProvider>
      </body>
    </html>
  );
}

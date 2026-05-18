import type { Metadata } from "next";
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
  return (
    <html lang="pt-BR" data-scroll-behavior="smooth">
      <body className="bg-zinc-950 text-zinc-100 antialiased">
        {children}
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";
import { getAppUrl } from "@/lib/app-url";

export const metadata: Metadata = {
  metadataBase: new URL(getAppUrl() ?? "http://localhost:3000"),
  title: {
    default: "Espaço Alfa | Cuidado para todos os cabelos",
    template: "%s | Espaço Alfa",
  },
  description: "Cortes, barba e cuidado especializado em Porto Velho. Escolha seu profissional e agende online.",
  openGraph: {
    title: "Espaço Alfa",
    description: "Seu momento, seu estilo. Agende seu atendimento online.",
    locale: "pt_BR",
    type: "website",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" data-scroll-behavior="smooth">
      <body className="antialiased">
        <a
          href="#conteudo"
          className="fixed left-4 top-3 z-[100] -translate-y-20 rounded-lg bg-amber-200 px-4 py-2 font-bold text-zinc-950 transition focus:translate-y-0"
        >
          Ir para o conteúdo
        </a>
        {children}
      </body>
    </html>
  );
}

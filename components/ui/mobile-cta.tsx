"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function MobileCta() {
  const pathname = usePathname();
  if (pathname === "/agendar") {
    return null;
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-800 bg-zinc-950/95 p-3 backdrop-blur sm:hidden">
      <Link
        href="/agendar"
        className="block rounded-lg bg-cyan-400 px-4 py-3 text-center text-sm font-bold text-zinc-950 transition hover:bg-cyan-300"
      >
        Agendar agora
      </Link>
    </div>
  );
}


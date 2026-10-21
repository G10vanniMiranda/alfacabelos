"use client";

import { useState } from "react";
import { ClientBookingCard } from "@/components/client/client-booking-card";
import type { BookingWithRelations, PaginatedResponse } from "@/types/domain";

export function ClientBookingHistory({ initialPage }: { initialPage: PaginatedResponse<BookingWithRelations> }) {
  const [bookings, setBookings] = useState(initialPage.data);
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor);
  const [hasMore, setHasMore] = useState(initialPage.hasMore);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadMore() {
    if (!nextCursor || isLoading) return;
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ cursor: nextCursor, limit: "12" });
      const response = await fetch(`/api/client/bookings?${params.toString()}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Não foi possível carregar mais atendimentos.");
      const page = (await response.json()) as PaginatedResponse<BookingWithRelations>;
      setBookings((current) => {
        const known = new Set(current.map((booking) => booking.id));
        return [...current, ...page.data.filter((booking) => !known.has(booking.id))];
      });
      setNextCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao carregar histórico.");
    } finally {
      setIsLoading(false);
    }
  }

  if (bookings.length === 0) {
    return <p className="mt-4 rounded-2xl border border-dashed border-white/15 p-5 text-sm text-stone-400">Seu histórico aparecerá aqui após o primeiro atendimento.</p>;
  }

  return (
    <>
      <div className="mt-4 grid gap-3">
        {bookings.map((booking) => <ClientBookingCard key={booking.id} booking={booking} canManage={false} />)}
      </div>
      {error ? <p role="alert" className="mt-3 text-sm text-red-300">{error}</p> : null}
      {hasMore ? (
        <button type="button" onClick={loadMore} disabled={isLoading} className="button-secondary mt-4 w-full disabled:opacity-60">
          {isLoading ? "Carregando…" : "Carregar mais atendimentos"}
        </button>
      ) : null}
    </>
  );
}

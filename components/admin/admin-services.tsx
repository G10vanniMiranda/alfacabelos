"use client";

import { useMemo, useState, useTransition } from "react";
import { createServiceAction, deleteServiceAction, updateServiceAction } from "@/lib/actions/booking-actions";
import { useToast } from "@/components/ui/toast";
import { Service } from "@/types/domain";

type AdminServicesProps = {
  services: Service[];
};

function formatPriceInput(priceCents: number): string {
  return (priceCents / 100).toFixed(2).replace(".", ",");
}

function parsePriceToCents(value: string): number {
  const normalized = value.replace("R$", "").trim().replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return NaN;
  }
  return Math.round(parsed * 100);
}

export function AdminServices({ services }: AdminServicesProps) {
  const [isPending, startTransition] = useTransition();
  const { pushToast } = useToast();
  const [newService, setNewService] = useState({ name: "", price: "" });
  const [editingServiceId, setEditingServiceId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", price: "" });

  const editingService = useMemo(
    () => services.find((service) => service.id === editingServiceId),
    [services, editingServiceId],
  );

  function openEditModal(service: Service) {
    setEditingServiceId(service.id);
    setEditForm({
      name: service.name,
      price: formatPriceInput(service.priceCents),
    });
  }

  function closeEditModal() {
    setEditingServiceId(null);
    setEditForm({ name: "", price: "" });
  }

  function submitNewService() {
    const priceCents = parsePriceToCents(newService.price);
    if (!newService.name.trim() || !Number.isFinite(priceCents)) {
      pushToast("Preencha nome e preço válido", "error");
      return;
    }

    startTransition(async () => {
      try {
        await createServiceAction({
          name: newService.name.trim(),
          priceCents,
        });
        pushToast("Serviço criado", "success");
        window.location.reload();
      } catch (error) {
        pushToast(error instanceof Error ? error.message : "Erro ao criar serviço", "error");
      }
    });
  }

  function submitEditService() {
    if (!editingServiceId) {
      return;
    }

    const priceCents = parsePriceToCents(editForm.price);
    if (!editForm.name.trim() || !Number.isFinite(priceCents)) {
      pushToast("Preencha nome e preço válido", "error");
      return;
    }

    startTransition(async () => {
      try {
        await updateServiceAction({
          serviceId: editingServiceId,
          name: editForm.name.trim(),
          priceCents,
        });
        pushToast("Serviço atualizado", "success");
        closeEditModal();
        window.location.reload();
      } catch (error) {
        pushToast(error instanceof Error ? error.message : "Erro ao atualizar serviço", "error");
      }
    });
  }

  function deleteService(serviceId: string) {
    startTransition(async () => {
      try {
        await deleteServiceAction({ serviceId });
        pushToast("Serviço removido", "success");
        window.location.reload();
      } catch (error) {
        pushToast(error instanceof Error ? error.message : "Erro ao remover serviço", "error");
      }
    });
  }

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 px-5 py-4">
        <h2 className="text-2xl font-semibold text-zinc-100">Serviços</h2>
        <p className="mt-1 text-sm text-zinc-400">Gerencie os serviços exibidos para os clientes.</p>
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
        <h3 className="text-lg font-semibold text-zinc-100">Adicionar novo serviço</h3>
        <div className="mt-3 grid gap-2 md:grid-cols-[1fr_180px_auto]">
          <input
            type="text"
            value={newService.name}
            onChange={(event) => setNewService((prev) => ({ ...prev, name: event.target.value }))}
            placeholder="Nome do serviço"
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
          />
          <input
            type="text"
            value={newService.price}
            onChange={(event) => setNewService((prev) => ({ ...prev, price: event.target.value }))}
            placeholder="0,00"
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
          />
          <button
            type="button"
            disabled={isPending}
            onClick={submitNewService}
            className="rounded-lg bg-cyan-400 px-4 py-2 text-sm font-bold text-zinc-950 disabled:opacity-70"
          >
            Adicionar
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
        <h3 className="text-lg font-semibold text-zinc-100">Serviços cadastrados</h3>
        <div className="mt-4 space-y-3">
          {services.map((service) => (
            <article
              key={service.id}
              className="rounded-lg border border-zinc-700 bg-zinc-950/70 p-4 sm:flex sm:items-center sm:justify-between"
            >
              <div>
                <p className="font-semibold text-zinc-100">{service.name}</p>
                <p className="mt-1 text-sm text-cyan-300">R$ {formatPriceInput(service.priceCents)}</p>
              </div>
              <div className="mt-3 flex items-center gap-2 sm:mt-0">
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => openEditModal(service)}
                  className="rounded-md border border-zinc-600 px-3 py-2 text-sm font-semibold text-zinc-100 transition hover:border-cyan-300 disabled:opacity-70"
                >
                  Editar
                </button>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => deleteService(service.id)}
                  className="rounded-md border border-red-500/60 px-3 py-2 text-sm font-semibold text-red-200 transition hover:bg-red-500/10 disabled:opacity-70"
                >
                  Excluir
                </button>
              </div>
            </article>
          ))}
        </div>
      </div>

      {editingService ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/80 p-4">
          <div className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl">
            <h3 className="text-lg font-semibold text-zinc-100">Editar serviço</h3>
            <p className="mt-1 text-sm text-zinc-400">Atualize nome e preço do serviço.</p>

            <div className="mt-4 space-y-3">
              <div>
                <label className="text-sm text-zinc-300">Nome</label>
                <input
                  type="text"
                  value={editForm.name}
                  onChange={(event) => setEditForm((prev) => ({ ...prev, name: event.target.value }))}
                  className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
                />
              </div>
              <div>
                <label className="text-sm text-zinc-300">Preço</label>
                <input
                  type="text"
                  value={editForm.price}
                  onChange={(event) => setEditForm((prev) => ({ ...prev, price: event.target.value }))}
                  placeholder="0,00"
                  className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
                />
              </div>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeEditModal}
                className="rounded-md border border-zinc-600 px-3 py-2 text-sm font-semibold text-zinc-200"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={submitEditService}
                className="rounded-md bg-cyan-400 px-4 py-2 text-sm font-bold text-zinc-950 disabled:opacity-70"
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

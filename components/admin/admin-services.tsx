"use client";

import { useState, useTransition } from "react";
import { createServiceAction, updateServiceAction } from "@/lib/actions/booking-actions";
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

  const [serviceForm, setServiceForm] = useState<Record<string, { name: string; price: string }>>(
    () =>
      Object.fromEntries(
        services.map((service) => [service.id, { name: service.name, price: formatPriceInput(service.priceCents) }]),
      ),
  );
  const [newService, setNewService] = useState({ name: "", price: "" });

  function submitService(serviceId: string) {
    const form = serviceForm[serviceId];
    if (!form) {
      pushToast("Servico invalido", "error");
      return;
    }

    const priceCents = parsePriceToCents(form.price);
    if (!form.name.trim() || !Number.isFinite(priceCents)) {
      pushToast("Preencha nome e preco valido", "error");
      return;
    }

    startTransition(async () => {
      try {
        await updateServiceAction({
          serviceId,
          name: form.name.trim(),
          priceCents,
        });
        pushToast("Servico atualizado", "success");
        window.location.reload();
      } catch (error) {
        pushToast(error instanceof Error ? error.message : "Erro ao atualizar servico", "error");
      }
    });
  }

  function submitNewService() {
    const priceCents = parsePriceToCents(newService.price);
    if (!newService.name.trim() || !Number.isFinite(priceCents)) {
      pushToast("Preencha nome e preco valido", "error");
      return;
    }

    startTransition(async () => {
      try {
        await createServiceAction({
          name: newService.name.trim(),
          priceCents,
        });
        pushToast("Servico criado", "success");
        window.location.reload();
      } catch (error) {
        pushToast(error instanceof Error ? error.message : "Erro ao criar servico", "error");
      }
    });
  }

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 px-5 py-4">
        <h2 className="text-2xl font-semibold text-zinc-100">Servicos</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Edite nome e preco dos servicos exibidos para os clientes.
        </p>
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
        <h3 className="text-lg font-semibold text-zinc-100">Adicionar novo servico</h3>
        <div className="mt-3 grid gap-2 md:grid-cols-[1fr_180px_auto]">
          <input
            type="text"
            value={newService.name}
            onChange={(event) => setNewService((prev) => ({ ...prev, name: event.target.value }))}
            placeholder="Nome do servico"
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
        <h3 className="text-lg font-semibold text-zinc-100">Servicos cadastrados</h3>
        <div className="mt-4 space-y-3">
          {services.map((service) => (
            <div
              key={service.id}
              className="grid gap-2 rounded-lg border border-zinc-700 bg-zinc-950/70 p-3 md:grid-cols-[1fr_180px_auto]"
            >
              <input
                type="text"
                value={serviceForm[service.id]?.name ?? ""}
                onChange={(event) =>
                  setServiceForm((prev) => ({
                    ...prev,
                    [service.id]: {
                      ...(prev[service.id] ?? { name: "", price: "" }),
                      name: event.target.value,
                    },
                  }))
                }
                className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
              />
              <input
                type="text"
                value={serviceForm[service.id]?.price ?? ""}
                onChange={(event) =>
                  setServiceForm((prev) => ({
                    ...prev,
                    [service.id]: {
                      ...(prev[service.id] ?? { name: "", price: "" }),
                      price: event.target.value,
                    },
                  }))
                }
                placeholder="0,00"
                className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
              />
              <button
                type="button"
                disabled={isPending}
                onClick={() => submitService(service.id)}
                className="rounded-lg bg-cyan-400 px-4 py-2 text-sm font-bold text-zinc-950 disabled:opacity-70"
              >
                Salvar
              </button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

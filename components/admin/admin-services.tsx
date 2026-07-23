"use client";

import { useMemo, useState, useTransition } from "react";
import { createServiceAction, deleteServiceAction, updateServiceAction } from "@/lib/actions/booking-actions";
import { useToast } from "@/components/ui/toast";
import { STANDARD_SERVICE_MAX_MINUTES } from "@/lib/scheduling-rules";
import { formatBRLFromCents } from "@/lib/utils";
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
  const [newService, setNewService] = useState({ name: "", price: "", durationMinutes: "45", isProcedure: false });
  const [editingServiceId, setEditingServiceId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", price: "", durationMinutes: "45", isProcedure: false });

  const editingService = useMemo(
    () => services.find((service) => service.id === editingServiceId),
    [services, editingServiceId],
  );
  const averagePriceCents =
    services.length > 0 ? Math.round(services.reduce((sum, service) => sum + service.priceCents, 0) / services.length) : 0;
  const highestPriceService = services.reduce<Service | undefined>((highest, service) => {
    if (!highest || service.priceCents > highest.priceCents) {
      return service;
    }
    return highest;
  }, undefined);

  function openEditModal(service: Service) {
    setEditingServiceId(service.id);
    setEditForm({
      name: service.name,
      price: formatPriceInput(service.priceCents),
      durationMinutes: String(service.durationMinutes),
      isProcedure: service.isProcedure,
    });
  }

  function closeEditModal() {
    setEditingServiceId(null);
    setEditForm({ name: "", price: "", durationMinutes: "45", isProcedure: false });
  }

  function submitNewService() {
    const priceCents = parsePriceToCents(newService.price);
    const durationMinutes = Number(newService.durationMinutes);
    const maxDuration = newService.isProcedure ? 240 : STANDARD_SERVICE_MAX_MINUTES;
    if (!newService.name.trim() || !Number.isFinite(priceCents) || !Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > maxDuration) {
      pushToast(`Preencha nome, preço e duração entre 15 e ${maxDuration} minutos`, "error");
      return;
    }

    startTransition(async () => {
      try {
        await createServiceAction({
          name: newService.name.trim(),
          priceCents,
          durationMinutes,
          isProcedure: newService.isProcedure,
        });
        setNewService({ name: "", price: "", durationMinutes: "45", isProcedure: false });
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
    const durationMinutes = Number(editForm.durationMinutes);
    const maxDuration = editForm.isProcedure ? 240 : STANDARD_SERVICE_MAX_MINUTES;
    if (!editForm.name.trim() || !Number.isFinite(priceCents) || !Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > maxDuration) {
      pushToast(`Preencha nome, preço e duração entre 15 e ${maxDuration} minutos`, "error");
      return;
    }

    startTransition(async () => {
      try {
        await updateServiceAction({
          serviceId: editingServiceId,
          name: editForm.name.trim(),
          priceCents,
          durationMinutes,
          isProcedure: editForm.isProcedure,
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
    const service = services.find((item) => item.id === serviceId);
    const confirmed = window.confirm(`Remover ${service?.name ?? "este serviço"} do catálogo?`);
    if (!confirmed) {
      return;
    }

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
      <header className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-brand-highlight">Catálogo</p>
            <h2 className="mt-2 text-2xl font-bold text-zinc-100 sm:text-3xl">Serviços</h2>
            <p className="mt-2 max-w-2xl text-sm text-zinc-400">
              Configure os serviços que aparecem para o cliente no agendamento online.
            </p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-4 py-3">
            <p className="text-xs text-copy-muted">Maior ticket</p>
            <p className="mt-1 text-sm font-semibold text-zinc-100">{highestPriceService?.name ?? "Sem serviços"}</p>
            <p className="text-xs text-brand-soft">
              {highestPriceService ? formatBRLFromCents(highestPriceService.priceCents) : formatBRLFromCents(0)}
            </p>
          </div>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <article className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-copy-muted">Ativos</p>
          <p className="mt-3 text-3xl font-black text-zinc-100">{services.length}</p>
          <p className="mt-1 text-sm text-zinc-400">serviços no catálogo</p>
        </article>
        <article className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-copy-muted">Preço medio</p>
          <p className="mt-3 text-3xl font-black text-brand-soft">{formatBRLFromCents(averagePriceCents)}</p>
          <p className="mt-1 text-sm text-zinc-400">baseado nos serviços ativos</p>
        </article>
        <article className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-copy-muted">Duração média</p>
          <p className="mt-3 text-3xl font-black text-success-soft">
            {services.length ? Math.round(services.reduce((sum, service) => sum + service.durationMinutes, 0) / services.length) : 0} min
          </p>
          <p className="mt-1 text-sm text-zinc-400">calculada sobre os serviços ativos</p>
        </article>
      </div>

      <div className="grid gap-6 xl:grid-cols-[390px_1fr]">
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
          <h3 className="text-lg font-semibold text-zinc-100">Novo serviço</h3>
          <p className="mt-1 text-sm text-copy-muted">Informe nome e preço final exibido ao cliente.</p>

          <div className="mt-5 space-y-4">
            <label className="block">
              <span className="text-sm font-medium text-zinc-300">Nome</span>
              <input
                type="text"
                value={newService.name}
                onChange={(event) => setNewService((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="Ex: Corte masculino"
                className="ui-control mt-2 h-11 w-full px-3"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-zinc-300">Preço</span>
              <input
                type="text"
                value={newService.price}
                onChange={(event) => setNewService((prev) => ({ ...prev, price: event.target.value }))}
                placeholder="0,00"
                className="ui-control mt-2 h-11 w-full px-3"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-zinc-300">Duração (minutos)</span>
              <input
                type="number"
                min={15}
                max={newService.isProcedure ? 240 : STANDARD_SERVICE_MAX_MINUTES}
                step={5}
                value={newService.durationMinutes}
                onChange={(event) => setNewService((prev) => ({ ...prev, durationMinutes: event.target.value }))}
                className="ui-control mt-2 h-11 w-full px-3"
              />
            </label>
            <label className="flex items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
              <input
                type="checkbox"
                checked={newService.isProcedure}
                onChange={(event) => setNewService((prev) => ({ ...prev, isProcedure: event.target.checked }))}
                className="mt-1 size-4 accent-brand"
              />
              <span>
                <span className="block text-sm font-medium text-zinc-200">Este serviço é um procedimento</span>
                <span className="mt-1 block text-xs text-copy-muted">
                  Serviços comuns usam um bloco de 1 hora; procedimentos podem durar mais.
                </span>
              </span>
            </label>
            <button
              type="button"
              disabled={isPending}
              onClick={submitNewService}
              className="button-primary h-11 w-full px-4 disabled:opacity-70"
            >
              Adicionar serviço
            </button>
          </div>
        </section>

        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-zinc-100">Serviços cadastrados</h3>
              <p className="mt-1 text-sm text-copy-muted">Edite valores ou remova itens que não devem aparecer.</p>
            </div>
            <span className="w-fit rounded-full border border-zinc-700 px-3 py-1 text-xs font-semibold text-zinc-300">
              {services.length} ativos
            </span>
          </div>

          <div className="mt-5 grid gap-3">
            {services.map((service) => (
              <article
                key={service.id}
                className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 transition hover:border-zinc-700"
              >
                <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-center">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-zinc-100">{service.name}</p>
                      <span className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[11px] font-semibold text-success-soft">
                        Ativo
                      </span>
                      {service.isProcedure ? (
                        <span className="rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 text-[11px] font-semibold text-brand-soft">
                          Procedimento
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2">
                        <p className="text-xs text-copy-muted">Preço</p>
                        <p className="mt-1 font-semibold text-brand-soft">{formatBRLFromCents(service.priceCents)}</p>
                      </div>
                      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2">
                        <p className="text-xs text-copy-muted">Duração</p>
                        <p className="mt-1 font-semibold text-zinc-100">{service.durationMinutes} min</p>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => openEditModal(service)}
                      className="button-secondary flex-1 px-3 py-2 sm:flex-none"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => deleteService(service.id)}
                      className="button-danger flex-1 px-3 py-2 sm:flex-none"
                    >
                      Remover
                    </button>
                  </div>
                </div>
              </article>
            ))}
            {services.length === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-950/40 p-6 text-center text-sm text-copy-muted">
                Nenhum serviço cadastrado.
              </div>
            ) : null}
          </div>
        </section>
      </div>

      {editingService ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/80 p-4 backdrop-blur-sm">
          <div role="dialog" aria-modal="true" aria-labelledby="edit-service-title" className="ui-modal-panel max-h-[90vh] w-full max-w-lg overflow-y-auto p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 id="edit-service-title" className="text-lg font-semibold text-zinc-100">Editar serviço</h3>
                <p className="mt-1 text-sm text-zinc-400">Atualize nome e preço exibidos no agendamento.</p>
              </div>
              <button
                type="button"
                onClick={closeEditModal}
                className="button-secondary px-3 py-2"
              >
                Fechar
              </button>
            </div>

            <div className="mt-5 grid gap-4">
              <label className="block">
                <span className="text-sm font-medium text-zinc-300">Nome</span>
                <input
                  type="text"
                  value={editForm.name}
                  onChange={(event) => setEditForm((prev) => ({ ...prev, name: event.target.value }))}
                  className="ui-control mt-2 h-11 w-full px-3"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-zinc-300">Preço</span>
                <input
                  type="text"
                  value={editForm.price}
                  onChange={(event) => setEditForm((prev) => ({ ...prev, price: event.target.value }))}
                  placeholder="0,00"
                  className="ui-control mt-2 h-11 w-full px-3"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-zinc-300">Duração (minutos)</span>
                <input
                  type="number"
                  min={15}
                  max={editForm.isProcedure ? 240 : STANDARD_SERVICE_MAX_MINUTES}
                  step={5}
                  value={editForm.durationMinutes}
                  onChange={(event) => setEditForm((prev) => ({ ...prev, durationMinutes: event.target.value }))}
                  className="ui-control mt-2 h-11 w-full px-3"
                />
              </label>
              <label className="flex items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
                <input
                  type="checkbox"
                  checked={editForm.isProcedure}
                  onChange={(event) => setEditForm((prev) => ({ ...prev, isProcedure: event.target.checked }))}
                  className="mt-1 size-4 accent-brand"
                />
                <span>
                  <span className="block text-sm font-medium text-zinc-200">Este serviço é um procedimento</span>
                  <span className="mt-1 block text-xs text-copy-muted">
                    Serviços comuns usam um bloco de 1 hora; procedimentos podem durar mais.
                  </span>
                </span>
              </label>
            </div>

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeEditModal}
                className="button-secondary h-10 w-full px-3 sm:w-auto"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={submitEditService}
                className="button-primary h-10 w-full px-4 disabled:opacity-70 sm:w-auto"
              >
                Salvar alterações
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

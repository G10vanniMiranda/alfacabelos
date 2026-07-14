"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import {
  createAdminAccessAction,
  deleteAdminAccessAction,
  updateAdminAccessAction,
} from "@/lib/actions/admin-access-actions";
import { useToast } from "@/components/ui/toast";
import { AdminAccessUser, Barber } from "@/types/domain";

const initialState = { success: false, message: "" };

type AdminAccessesProps = {
  accesses: AdminAccessUser[];
  barbers: Barber[];
  loadError?: string;
};

type EditDraft = {
  accessId: string;
  email: string;
  password: string;
  confirmPassword: string;
  role: "ADMIN" | "BARBER";
  barberId: string;
};

function formatDateTime(iso?: string) {
  if (!iso) {
    return "Nunca";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(iso));
}

export function AdminAccesses({ accesses, barbers, loadError }: AdminAccessesProps) {
  const { pushToast } = useToast();
  const [state, formAction, isPendingCreate] = useActionState(createAdminAccessAction, initialState);
  const [isPendingDelete, startDeleteTransition] = useTransition();
  const [isPendingUpdate, startUpdateTransition] = useTransition();
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);

  useEffect(() => {
    if (!state.message) {
      return;
    }

    pushToast(state.message, state.success ? "success" : "error");
    if (state.success) {
      window.location.reload();
    }
  }, [state, pushToast]);

  function handleDelete(accessId: string) {
    startDeleteTransition(async () => {
      const result = await deleteAdminAccessAction(accessId);
      pushToast(result.message || "Falha ao remover acesso", result.success ? "success" : "error");
      if (result.success) {
        window.location.reload();
      }
    });
  }

  function startEditing(access: AdminAccessUser) {
    setEditDraft({
      accessId: access.id,
      email: access.email,
      password: "",
      confirmPassword: "",
      role: access.role,
      barberId: access.barberId ?? "",
    });
  }

  function handleSave() {
    if (!editDraft) {
      return;
    }

    startUpdateTransition(async () => {
      const result = await updateAdminAccessAction(editDraft);
      pushToast(result.message || "Falha ao atualizar acesso", result.success ? "success" : "error");
      if (result.success) {
        setEditDraft(null);
        window.location.reload();
      }
    });
  }

  const isBusy = isPendingCreate || isPendingDelete || isPendingUpdate || Boolean(loadError);

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 px-4 py-4 sm:px-5">
        <h2 className="text-xl font-semibold text-zinc-100 sm:text-2xl">Acessos Admin</h2>
        <p className="mt-1 text-sm text-zinc-400">Gerencie quem pode entrar no painel administrativo.</p>
      </div>

      {loadError ? (
        <div className="rounded-2xl border border-amber-600/50 bg-amber-500/10 p-4 text-sm text-amber-100">
          <p className="font-semibold">A secao de acessos precisa de migration</p>
          <p className="mt-1">{loadError}</p>
          <p className="mt-2 text-amber-200">Execute: npm run prisma:migrate:deploy</p>
        </div>
      ) : null}

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
        <h3 className="text-lg font-semibold text-zinc-100">Criar novo acesso</h3>
        <form action={formAction} className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-6">
          <input
            type="email"
            name="email"
            placeholder="novo-admin@alfa.com"
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
          />
          <select name="role" className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"><option value="ADMIN">Administrador</option><option value="BARBER">Barbeiro</option></select>
          <select name="barberId" className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"><option value="">Sem vinculo</option>{barbers.map((barber) => <option key={barber.id} value={barber.id}>{barber.name}</option>)}</select>
          <input
            type="password"
            name="password"
            placeholder="Senha"
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
          />
          <input
            type="password"
            name="confirmPassword"
            placeholder="Confirmar senha"
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
          />
          <button
            type="submit"
            disabled={isPendingCreate || Boolean(loadError)}
            className="rounded-lg bg-cyan-400 px-4 py-2 text-sm font-bold text-zinc-950 disabled:opacity-60"
          >
            {isPendingCreate ? "Salvando..." : "Adicionar"}
          </button>
        </form>
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
        <h3 className="text-lg font-semibold text-zinc-100">Acessos cadastrados</h3>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-180 text-left text-sm">
            <thead className="text-zinc-400">
              <tr>
                <th className="px-2 py-2">Email</th>
                <th className="px-2 py-2">Perfil</th>
                <th className="px-2 py-2">Criado em</th>
                <th className="px-2 py-2">Ultimo login</th>
                <th className="px-2 py-2">Acoes</th>
              </tr>
            </thead>
            <tbody>
              {accesses.map((access) => {
                const isEditing = editDraft?.accessId === access.id;
                const currentEdit = isEditing ? editDraft : null;

                return (
                  <tr key={access.id} className="border-t border-zinc-800 text-zinc-200 align-top">
                    <td className="px-2 py-2">
                      {currentEdit ? (
                        <div className="space-y-2">
                          <input
                            type="email"
                            value={currentEdit.email}
                            onChange={(event) =>
                              setEditDraft((prev) => (prev ? { ...prev, email: event.target.value } : prev))
                            }
                            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
                          />
                          <input
                            type="password"
                            value={currentEdit.password}
                            onChange={(event) =>
                              setEditDraft((prev) => (prev ? { ...prev, password: event.target.value } : prev))
                            }
                            placeholder="Nova senha (opcional)"
                            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
                          />
                          <input
                            type="password"
                            value={currentEdit.confirmPassword}
                            onChange={(event) =>
                              setEditDraft((prev) =>
                                prev ? { ...prev, confirmPassword: event.target.value } : prev,
                              )
                            }
                            placeholder="Confirmar nova senha"
                            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
                          />
                        </div>
                      ) : (
                        access.email
                      )}
                    </td>
                    <td className="px-2 py-2 text-zinc-300">{currentEdit ? <div className="space-y-2"><select value={currentEdit.role} onChange={(event) => setEditDraft((prev) => prev ? { ...prev, role: event.target.value as "ADMIN" | "BARBER" } : prev)} className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-2"><option value="ADMIN">Administrador</option><option value="BARBER">Barbeiro</option></select>{currentEdit.role === "BARBER" ? <select value={currentEdit.barberId} onChange={(event) => setEditDraft((prev) => prev ? { ...prev, barberId: event.target.value } : prev)} className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-2"><option value="">Selecione</option>{barbers.map((barber) => <option key={barber.id} value={barber.id}>{barber.name}</option>)}</select> : null}</div> : access.role === "ADMIN" ? "Administrador" : barbers.find((barber) => barber.id === access.barberId)?.name ?? "Barbeiro"}</td>
                    <td className="px-2 py-2 text-zinc-400">{formatDateTime(access.createdAt)}</td>
                    <td className="px-2 py-2 text-zinc-400">{formatDateTime(access.lastLoginAt)}</td>
                    <td className="px-2 py-2">
                      <div className="flex gap-2">
                        {isEditing ? (
                          <>
                            <button
                              type="button"
                              title="Salvar"
                              aria-label="Salvar"
                              disabled={isBusy}
                              onClick={handleSave}
                              className="rounded-md border border-cyan-500/60 px-3 py-1.5 text-sm text-cyan-200 transition hover:bg-cyan-500/10 disabled:opacity-50"
                            >
                              {"\uD83D\uDCBE"}
                            </button>
                            <button
                              type="button"
                              title="Cancelar"
                              aria-label="Cancelar"
                              disabled={isBusy}
                              onClick={() => setEditDraft(null)}
                              className="rounded-md border border-zinc-600 px-3 py-1.5 text-sm text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-50"
                            >
                              {"\u2716"}
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              title="Editar"
                              aria-label="Editar"
                              disabled={isBusy}
                              onClick={() => startEditing(access)}
                              className="rounded-md border border-cyan-500/60 px-3 py-1.5 text-sm text-cyan-200 transition hover:bg-cyan-500/10 disabled:opacity-50"
                            >
                              {"\u270F\uFE0F"}
                            </button>
                            <button
                              type="button"
                              title="Remover"
                              aria-label="Remover"
                              disabled={isBusy || accesses.length <= 1}
                              onClick={() => handleDelete(access.id)}
                              className="rounded-md border border-red-500/60 px-3 py-1.5 text-sm text-red-200 transition hover:bg-red-500/10 disabled:opacity-50"
                            >
                              {"\uD83D\uDDD1\uFE0F"}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {accesses.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-2 py-4 text-center text-zinc-500">
                    Nenhum acesso admin cadastrado.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

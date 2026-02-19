"use client";

import { useActionState, useEffect, useTransition } from "react";
import { createAdminAccessAction, deleteAdminAccessAction } from "@/lib/actions/admin-access-actions";
import { useToast } from "@/components/ui/toast";
import { AdminAccessUser } from "@/types/domain";

const initialState = { success: false, message: "" };

type AdminAccessesProps = {
  accesses: AdminAccessUser[];
  loadError?: string;
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

export function AdminAccesses({ accesses, loadError }: AdminAccessesProps) {
  const { pushToast } = useToast();
  const [state, formAction, isPendingCreate] = useActionState(createAdminAccessAction, initialState);
  const [isPendingDelete, startDeleteTransition] = useTransition();

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

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 px-4 py-4 sm:px-5">
        <h2 className="text-xl font-semibold text-zinc-100 sm:text-2xl">Acessos Admin</h2>
        <p className="mt-1 text-sm text-zinc-400">Gerencie quem pode entrar no painel administrativo.</p>
      </div>

      {loadError ? (
        <div className="rounded-2xl border border-amber-600/50 bg-amber-500/10 p-4 text-sm text-amber-100">
          <p className="font-semibold">A seção de acessos precisa de migration</p>
          <p className="mt-1">{loadError}</p>
          <p className="mt-2 text-amber-200">Execute: npm run prisma:migrate:deploy</p>
        </div>
      ) : null}

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
        <h3 className="text-lg font-semibold text-zinc-100">Criar novo acesso</h3>
        <form action={formAction} className="mt-4 grid gap-2 md:grid-cols-[1fr_220px_220px_auto]">
          <input
            type="email"
            name="email"
            placeholder="novo-admin@alfa.com"
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
          />
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
                <th className="px-2 py-2">Criado em</th>
                <th className="px-2 py-2">Último login</th>
                <th className="px-2 py-2">Ações</th>
              </tr>
            </thead>
            <tbody>
              {accesses.map((access) => (
                <tr key={access.id} className="border-t border-zinc-800 text-zinc-200">
                  <td className="px-2 py-2">{access.email}</td>
                  <td className="px-2 py-2 text-zinc-400">{formatDateTime(access.createdAt)}</td>
                  <td className="px-2 py-2 text-zinc-400">{formatDateTime(access.lastLoginAt)}</td>
                  <td className="px-2 py-2">
                    <button
                      type="button"
                      disabled={isPendingDelete || accesses.length <= 1 || Boolean(loadError)}
                      onClick={() => handleDelete(access.id)}
                      className="rounded-md border border-red-500/60 px-3 py-1.5 text-xs font-semibold text-red-200 transition hover:bg-red-500/10 disabled:opacity-50"
                    >
                      Remover
                    </button>
                  </td>
                </tr>
              ))}
              {accesses.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-2 py-4 text-center text-zinc-500">
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

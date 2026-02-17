"use client";

import { useState, useTransition } from "react";
import { deleteGalleryImageAction, uploadGalleryImageAction } from "@/lib/actions/booking-actions";
import { useToast } from "@/components/ui/toast";
import { GalleryImage } from "@/types/domain";

type AdminGalleryProps = {
  images: GalleryImage[];
};

export function AdminGallery({ images }: AdminGalleryProps) {
  const [isPending, startTransition] = useTransition();
  const { pushToast } = useToast();
  const [form, setForm] = useState({ altText: "" });
  const [file, setFile] = useState<File | null>(null);

  function submitImage() {
    if (!file) {
      pushToast("Selecione uma imagem para upload", "error");
      return;
    }

    const data = new FormData();
    data.set("file", file);
    if (form.altText.trim()) {
      data.set("altText", form.altText.trim());
    }

    startTransition(async () => {
      try {
        await uploadGalleryImageAction(data);
        pushToast("Foto adicionada na galeria", "success");
        setForm({ altText: "" });
        setFile(null);
        window.location.reload();
      } catch (error) {
        pushToast(error instanceof Error ? error.message : "Erro ao adicionar foto", "error");
      }
    });
  }

  function deleteImage(galleryImageId: string) {
    startTransition(async () => {
      try {
        const image = images.find((item) => item.id === galleryImageId);
        await deleteGalleryImageAction({
          galleryImageId,
          imageUrl: image?.imageUrl,
        });
        pushToast("Foto removida", "success");
        window.location.reload();
      } catch (error) {
        pushToast(error instanceof Error ? error.message : "Erro ao remover foto", "error");
      }
    });
  }

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 px-4 py-4 sm:px-5">
        <h2 className="text-xl font-semibold text-zinc-100 sm:text-2xl">Galeria</h2>
        <p className="mt-1 text-sm text-zinc-400">Adicione fotos para exibir na seção Galeria da home.</p>
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
        <h3 className="text-lg font-semibold text-zinc-100">Nova foto</h3>
        <div className="mt-3 min-w-0 grid gap-2 md:grid-cols-[1fr_280px_auto]">
          <div className="min-w-0 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2">
            <label className="inline-flex cursor-pointer items-center rounded-md border border-zinc-600 px-3 py-1.5 text-sm font-semibold text-zinc-200 transition hover:border-cyan-300 hover:text-cyan-200">
              Escolher arquivo
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/avif"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                className="sr-only"
              />
            </label>
            <p className="mt-2 truncate text-xs text-zinc-400">
              {file ? file.name : "Nenhum arquivo selecionado"}
            </p>
          </div>
          <input
            type="text"
            value={form.altText}
            onChange={(event) => setForm((prev) => ({ ...prev, altText: event.target.value }))}
            placeholder="Descrição da imagem (opcional)"
            className="min-w-0 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
          />
          <button
            type="button"
            disabled={isPending}
            onClick={submitImage}
            className="w-full rounded-lg bg-cyan-400 px-4 py-2 text-sm font-bold text-zinc-950 disabled:opacity-70 md:w-auto"
          >
            Adicionar
          </button>
        </div>
        <p className="mt-2 text-xs text-zinc-500">Formatos: JPG, PNG, WEBP, AVIF (máx. 5MB)</p>
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
        <h3 className="text-lg font-semibold text-zinc-100">Fotos cadastradas</h3>
        {images.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-400">Nenhuma foto cadastrada ainda.</p>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {images.map((image) => (
              <article key={image.id} className="overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950/70">
                <img
                  src={image.imageUrl}
                  alt={image.altText ?? "Foto da galeria"}
                  className="aspect-square w-full object-cover"
                  loading="lazy"
                />
                <div className="space-y-2 p-3">
                  <p className="line-clamp-2 text-xs text-zinc-400">{image.altText ?? "Sem descrição"}</p>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => deleteImage(image.id)}
                    className="rounded-md border border-red-500/60 px-3 py-2 text-xs font-semibold text-red-200 transition hover:bg-red-500/10 disabled:opacity-70"
                  >
                    Remover
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

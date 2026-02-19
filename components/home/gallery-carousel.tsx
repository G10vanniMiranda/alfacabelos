"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { GalleryImage } from "@/types/domain";

type GalleryCarouselProps = {
  images: GalleryImage[];
};

export function GalleryCarousel({ images }: GalleryCarouselProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const hasImages = images.length > 0;
  const autoplayEnabled = hasImages && images.length > 1;

  const slides = useMemo(() => {
    if (hasImages) {
      return images.map((image) => ({
        id: image.id,
        imageUrl: image.imageUrl,
        alt: image.altText ?? "Foto da galeria da barbearia",
      }));
    }

    return [1, 2, 3, 4].map((item) => ({
      id: `placeholder-${item}`,
      imageUrl: "",
      alt: "Placeholder da galeria",
    }));
  }, [hasImages, images]);

  function goTo(index: number) {
    const track = trackRef.current;
    if (!track) {
      return;
    }

    const clamped = Math.max(0, Math.min(index, slides.length - 1));
    const slide = track.children[clamped] as HTMLElement | undefined;
    if (!slide) {
      return;
    }

    slide.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
    setActiveIndex(clamped);
  }

  function prev() {
    const nextIndex = activeIndex === 0 ? slides.length - 1 : activeIndex - 1;
    goTo(nextIndex);
  }

  function next() {
    const nextIndex = activeIndex === slides.length - 1 ? 0 : activeIndex + 1;
    goTo(nextIndex);
  }

  useEffect(() => {
    if (!autoplayEnabled) {
      return;
    }

    const timer = setInterval(() => {
      const track = trackRef.current;
      if (!track) {
        return;
      }

      const nextIndex = activeIndex === slides.length - 1 ? 0 : activeIndex + 1;
      const slide = track.children[nextIndex] as HTMLElement | undefined;
      if (!slide) {
        return;
      }

      slide.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
      setActiveIndex(nextIndex);
    }, 4500);

    return () => clearInterval(timer);
  }, [activeIndex, autoplayEnabled, slides.length]);

  useEffect(() => {
    function onScroll() {
      const trackEl = trackRef.current;
      if (!trackEl) {
        return;
      }

      const firstSlide = trackEl.children[0] as HTMLElement | undefined;
      if (!firstSlide) {
        return;
      }

      const slideWidth = firstSlide.offsetWidth;
      if (slideWidth <= 0) {
        return;
      }

      const current = Math.round(trackEl.scrollLeft / slideWidth);
      const normalized = Math.max(0, Math.min(current, slides.length - 1));
      setActiveIndex(normalized);
    }

    const trackEl = trackRef.current;
    if (!trackEl) {
      return;
    }

    trackEl.addEventListener("scroll", onScroll, { passive: true });
    return () => trackEl.removeEventListener("scroll", onScroll);
  }, [slides.length]);

  return (
    <div className="relative">
      <div
        ref={trackRef}
        className="flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {slides.map((slide) => (
          <article
            key={slide.id}
            className="min-w-0 shrink-0 basis-[86%] snap-start overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 sm:basis-[48%] lg:basis-[32%]"
          >
            {slide.imageUrl ? (
              <img
                src={slide.imageUrl}
                alt={slide.alt}
                className="aspect-[4/5] w-full object-cover transition duration-300 hover:scale-[1.02]"
                loading="lazy"
              />
            ) : (
              <div className="aspect-[4/5] w-full bg-linear-to-br from-zinc-900 via-zinc-800 to-cyan-950" />
            )}
          </article>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {slides.map((slide, index) => (
            <button
              key={`${slide.id}-dot`}
              type="button"
              onClick={() => goTo(index)}
              aria-label={`Ir para slide ${index + 1}`}
              className={`h-2.5 rounded-full transition ${
                index === activeIndex ? "w-7 bg-cyan-300" : "w-2.5 bg-zinc-600 hover:bg-zinc-500"
              }`}
            />
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={prev}
            aria-label="Slide anterior"
            className="rounded-md border border-zinc-700 bg-zinc-900/80 px-3 py-1.5 text-sm text-zinc-200 transition hover:border-cyan-400 hover:text-cyan-200"
          >
            Anterior
          </button>
          <button
            type="button"
            onClick={next}
            aria-label="Próximo slide"
            className="rounded-md border border-zinc-700 bg-zinc-900/80 px-3 py-1.5 text-sm text-zinc-200 transition hover:border-cyan-400 hover:text-cyan-200"
          >
            Próximo
          </button>
        </div>
      </div>
    </div>
  );
}

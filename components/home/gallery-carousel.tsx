import Image from "next/image";
import { GalleryImage } from "@/types/domain";

type GalleryCarouselProps = {
  images: GalleryImage[];
};

export function GalleryCarousel({ images }: GalleryCarouselProps) {
  const hasImages = images.length > 0;
  const slides = hasImages
    ? images.map((image) => ({
        id: image.id,
        imageUrl: image.imageUrl,
        alt: image.altText ?? "Foto da galeria da barbearia",
      }))
    : [1, 2, 3, 4].map((item) => ({
        id: `placeholder-${item}`,
        imageUrl: "",
        alt: "Placeholder da galeria",
      }));

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {slides.map((slide, index) => (
        <article
          key={slide.id}
          className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900"
        >
          {slide.imageUrl ? (
            <Image
              src={slide.imageUrl}
              alt={slide.alt}
              className="aspect-4/5 w-full object-cover transition duration-300 hover:scale-[1.02]"
              width={960}
              height={1200}
              loading={index === 0 ? "eager" : "lazy"}
              priority={index === 0}
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            />
          ) : (
            <div className="aspect-4/5 w-full bg-linear-to-br from-zinc-900 via-zinc-800 to-cyan-950" />
          )}
        </article>
      ))}
    </div>
  );
}

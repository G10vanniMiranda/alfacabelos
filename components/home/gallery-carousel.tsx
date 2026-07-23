import Image from "next/image";
import { GalleryImage } from "@/types/domain";

type GalleryCarouselProps = {
  images: GalleryImage[];
};

type GallerySlide = {
  id: string;
  imageUrl: string;
  alt: string;
  mediaType: "IMAGE" | "VIDEO";
};

export function GalleryCarousel({ images }: GalleryCarouselProps) {
  const hasImages = images.length > 0;
  const slides: GallerySlide[] = hasImages
    ? images.map((image) => ({
        id: image.id,
        imageUrl: image.imageUrl,
        alt: image.altText ?? "Mídia da galeria da barbearia",
        mediaType: image.mediaType === "VIDEO" ? "VIDEO" : "IMAGE",
      }))
    : [1, 2, 3, 4].map((item) => ({
        id: `placeholder-${item}`,
        imageUrl: "",
        alt: "Placeholder da galeria",
        mediaType: "IMAGE",
      }));

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {slides.map((slide, index) => (
        <article
          key={slide.id}
          className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900"
        >
          {slide.imageUrl ? (
            slide.mediaType === "VIDEO" ? (
              <video
                src={slide.imageUrl}
                className="aspect-4/5 w-full bg-black object-cover"
                controls
                preload={index === 0 ? "metadata" : "none"}
                playsInline
              />
            ) : (
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
            )
          ) : (
            <div className="aspect-4/5 w-full bg-linear-to-br from-zinc-900 via-zinc-800 to-brand-deep" />
          )}
        </article>
      ))}
    </div>
  );
}

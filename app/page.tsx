import { HeroSection } from "@/components/home/hero-section";
import { HomeSections } from "@/components/home/home-sections";
import { SiteHeader } from "@/components/ui/site-header";

export default function HomePage() {
  return (
    <div className="min-h-screen overflow-x-clip">
      <SiteHeader />
      <main id="conteudo">
        <HeroSection />
        <HomeSections />
      </main>
    </div>
  );
}


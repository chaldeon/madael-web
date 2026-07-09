import HeroSection from '@/components/home/HeroSection';
import ServicesSection from '@/components/home/ServicesSection';
import ClientsMarquee from '@/components/home/ClientsMarquee';
import ContactSection from '@/components/ContactSection';

export default function Home() {
  return (
    <>
      <HeroSection />
      <ServicesSection />
      <ClientsMarquee />
      <ContactSection />
    </>
  );
}

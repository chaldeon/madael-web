import AboutStory from '@/components/about/AboutStory';
import ValuesSection from '@/components/about/ValuesSection'; // langkah berikutnya
import ContactSection from '@/components/ContactSection'; // sudah ada, reuse

export default function AboutPage() {
  return (
    <>
      <AboutStory />
      <ValuesSection />
      <ContactSection />
    </>
  );
}
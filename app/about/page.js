import AboutStory from '@/components/about/AboutStory';
import ValuesSection from '@/components/about/ValuesSection'; // langkah berikutnya
import ContactSection from '@/components/ContactSection'; // sudah ada, reuse

export const metadata = {
  title: "Tentang Kami",
  description:
    "Kenali Madael Consult — konsultan HR & legal yang membantu bisnis di Indonesia mengelola SDM, kepatuhan hukum, dan operasional secara profesional.",
  openGraph: {
    title: "Tentang Kami | Madael Consult",
    description:
      "Kenali Madael Consult — konsultan HR & legal yang membantu bisnis di Indonesia mengelola SDM, kepatuhan hukum, dan operasional secara profesional.",
    url: "/about",
  },
};

export default function AboutPage() {
  return (
    <>
      <AboutStory />
      <ValuesSection />
      <ContactSection />
    </>
  );
}
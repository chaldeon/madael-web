'use client';

import { createContext, useContext, useEffect, useState } from 'react';

const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
  const [lang, setLang] = useState('id');

  useEffect(() => {
    const saved = localStorage.getItem('madael-lang');
    if (saved === 'id' || saved === 'en') setLang(saved);
  }, []);

  const toggleLang = () => {
    setLang((prev) => {
      const next = prev === 'id' ? 'en' : 'id';
      localStorage.setItem('madael-lang', next);
      return next;
    });
  };

  return (
    <LanguageContext.Provider value={{ lang, toggleLang }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within LanguageProvider');
  return ctx;
}

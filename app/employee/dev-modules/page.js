'use client';

import { GitBranch, ExternalLink } from 'lucide-react';
import { MODULE_REGISTRY } from '@/lib/employeeModules';

const STATUS_SECTIONS = [
  {
    key: 'live',
    label: 'Live',
    hint: 'Sudah tayang dan bisa diakses employee.',
    badgeClass: 'bg-madael-red text-white',
    iconBoxClass: 'bg-madael-red text-white',
  },
  {
    key: 'in_progress',
    label: 'In Progress',
    hint: 'Sedang dibangun — belum masuk domain utama.',
    badgeClass: 'bg-amber-100 text-amber-700',
    iconBoxClass: 'bg-amber-100 text-amber-700',
  },
  {
    key: 'coming_soon',
    label: 'Coming Soon',
    hint: 'Belum mulai dikerjakan.',
    badgeClass: 'bg-[#E0E0E0] text-[#6B6B6B]',
    iconBoxClass: 'bg-[#E0E0E0] text-[#9A9A9A]',
  },
];

export default function DevModulesPage() {
  return (
    <div className="max-w-[1100px] mx-auto px-6 py-10">
      <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em] mb-1">
        Dev / Staging Modules
      </h1>
      <p className="text-sm text-[#6B6B6B] mb-10">
        Roadmap internal semua modul — termasuk yang masih di-hide dari domain utama. Khusus superadmin.
      </p>

      {STATUS_SECTIONS.map((section) => {
        const mods = MODULE_REGISTRY.filter((mod) => mod.status === section.key);
        if (mods.length === 0) return null;

        return (
          <div key={section.key} className="mb-10">
            <div className="flex items-center gap-3 mb-1">
              <span className={`text-[10px] font-medium tracking-[0.04em] px-2 py-1 ${section.badgeClass}`}>
                {section.label.toUpperCase()}
              </span>
              <span className="text-xs text-[#6B6B6B]">{mods.length} modul</span>
            </div>
            <p className="text-xs text-[#9A9A9A] mb-4">{section.hint}</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {mods.map((mod) => {
                const Icon = mod.icon;
                return (
                  <div
                    key={mod.href}
                    className="bg-white border border-[#E0E0E0] p-5"
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className={`w-10 h-10 flex items-center justify-center ${section.iconBoxClass}`}>
                        <Icon size={18} />
                      </div>
                      {mod.superadminOnly && (
                        <span className="text-[10px] font-medium tracking-[0.04em] px-2 py-1 bg-[#E0E0E0] text-[#6B6B6B]">
                          SUPERADMIN
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-medium text-black mb-1">{mod.name}</p>
                    <p className="text-xs text-[#6B6B6B] mb-3">{mod.desc}</p>
                    <p className="text-[11px] text-[#9A9A9A] font-mono mb-2">{mod.href}</p>

                    {mod.branch && (
                      <div className="flex items-center gap-1.5 text-[11px] text-[#6B6B6B] font-mono mb-1.5">
                        <GitBranch size={12} />
                        {mod.branch}
                      </div>
                    )}
                    {mod.previewUrl ? (
                      <a
                        href={mod.previewUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] text-madael-red hover:text-madael-dark font-medium"
                      >
                        Lihat Preview <ExternalLink size={11} />
                      </a>
                    ) : mod.status === 'in_progress' ? (
                      <p className="text-[11px] text-[#9A9A9A] italic">Belum ada preview</p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
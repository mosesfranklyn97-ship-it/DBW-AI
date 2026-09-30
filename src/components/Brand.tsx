import Link from "next/link";

export function LogoMark({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="dbwGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#5b6cff" />
          <stop offset="55%" stopColor="#7c3aed" />
          <stop offset="100%" stopColor="#0ea5e9" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="44" height="44" rx="13" fill="url(#dbwGrad)" />
      <ellipse cx="24" cy="15" rx="12" ry="4.6" fill="#0b1020" opacity="0.85" />
      <path d="M12 15v8c0 2.5 5.4 4.6 12 4.6s12-2.1 12-4.6v-8" stroke="#0b1020" strokeWidth="2.6" opacity="0.85" fill="none" />
      <path d="M12 23v9c0 2.5 5.4 4.6 12 4.6s12-2.1 12-4.6v-9" stroke="#0b1020" strokeWidth="2.6" opacity="0.85" fill="none" />
      <circle cx="35" cy="34" r="7.5" fill="#0b1020" opacity="0.9" />
      <path d="M35 30.4v7.2M31.4 34h7.2" stroke="#7dd3fc" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

export function BrandLockup({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="group flex min-w-0 items-center gap-2.5">
      <LogoMark size={compact ? 30 : 36} />
      <span className="min-w-0 leading-none">
        <span className="block text-[17px] font-extrabold tracking-tight text-slate-900">
          DBW<span className="text-brand-600"> AI</span>
        </span>
        {!compact && (
          // Hidden on the narrowest screens: "ZeroBox Schema Engine" is ~194px
          // of uppercase text with 0.15em tracking, so at 320px it wrapped to
          // two lines and, under `leading-none`, the lines collided — growing
          // the sticky header on every page.
          <span className="hidden truncate text-xs font-medium uppercase tracking-[0.15em] text-slate-600 min-[360px]:block">
            ZeroBox Schema Engine
          </span>
        )}
      </span>
    </Link>
  );
}

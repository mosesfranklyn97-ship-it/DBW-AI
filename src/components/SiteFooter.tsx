import Link from "next/link";
import { LogoMark } from "@/components/Brand";

export default function SiteFooter() {
  return (
    <footer className="mt-20 border-t border-slate-200 bg-white/60">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-4">
        <div className="md:col-span-2">
          <div className="flex items-center gap-2.5">
            <LogoMark size={32} />
            <span className="text-base font-extrabold text-slate-900">DBW AI</span>
          </div>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-slate-500">
            Speak or type your idea — DBW AI (ZeroBox Schema Engine) designs the tables, keys, relationships,
            seed data and ER diagram, then hands you clean SQL you can open anywhere.
          </p>
        </div>
        <div>
          <h4 className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Product</h4>
          <ul className="mt-2 space-y-1 text-sm text-slate-700">
            <li><Link href="/#build" className="inline-block py-1.5 hover:text-brand-600">Generate schema</Link></li>
            <li><Link href="/projects" className="inline-block py-1.5 hover:text-brand-600">My databases</Link></li>
            <li><Link href="/pricing" className="inline-block py-1.5 hover:text-brand-600">Pricing</Link></li>
          </ul>
        </div>
        <div>
          <h4 className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Exports</h4>
          <ul className="mt-3 space-y-2 text-sm text-slate-700">
            <li>MySQL · phpMyAdmin</li>
            <li>PostgreSQL · pgAdmin</li>
            <li>SQLite · mobile apps</li>
            <li>Supabase · RLS ready</li>
          </ul>
        </div>
      </div>
      <div className="safe-bottom-flush border-t border-slate-200 px-4 py-5 text-center text-xs text-slate-500 sm:px-6">
        © {new Date().getFullYear()} DBW AI · ZeroBox AI Schema. Built for builders in Freetown and everywhere.
      </div>
    </footer>
  );
}

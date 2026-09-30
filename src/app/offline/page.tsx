import Link from "next/link";
import { LogoMark } from "@/components/Brand";

export const metadata = { title: "Offline — DBW AI" };

export default function OfflinePage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-5 pb-[calc(4rem+env(safe-area-inset-bottom,0px))] pt-[calc(4rem+env(safe-area-inset-top,0px))] text-center">
      <LogoMark size={56} />
      <h1 className="mt-6 text-2xl font-extrabold text-slate-900">You are offline</h1>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-slate-500">
        DBW AI needs a connection to run the schema engine. Reconnect and tap retry — your saved databases are
        waiting.
      </p>
      <Link
        href="/"
        className="btn-primary mt-7 inline-flex rounded-xl px-6 py-3 text-sm font-bold text-white"
      >
        Retry
      </Link>
    </div>
  );
}

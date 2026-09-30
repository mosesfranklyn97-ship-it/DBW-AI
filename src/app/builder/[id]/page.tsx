import BuilderClient from "@/components/builder/BuilderClient";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";

export const dynamic = "force-dynamic";

export default async function BuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="min-h-dvh">
      <SiteHeader />
      {/* Keyed so switching projects remounts the builder instead of leaving
          the previous database on screen until the new request resolves. */}
      <BuilderClient key={id} projectId={id} />
      <SiteFooter />
    </div>
  );
}

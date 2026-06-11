import PageContent from "./_PageContent";

export const dynamic = "force-static";
export function generateStaticParams() {
  return [];
}

export default function Page() {
  return <PageContent />;
}

import PageContent from "./_PageContent";

export const dynamic = "force-static";
export function generateStaticParams() {
  return [];
}

export default function Page(props: { params: Promise<{ id: string }> }) {
  return <PageContent params={props.params} />;
}

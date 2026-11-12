import MissionDetailPremium from '@/components/MissionDetailPremium';

export const dynamic = 'force-dynamic';

export default async function MissionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ demo?: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const { demo } = (await searchParams) ?? {};
  return <MissionDetailPremium missionId={id} demo={demo === 'true'} />;
}

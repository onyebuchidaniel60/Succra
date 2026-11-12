import MissionDetailPremium from '@/components/MissionDetailPremium';

export const dynamic = 'force-dynamic';

export default async function MissionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  return <MissionDetailPremium missionId={id} />;
}

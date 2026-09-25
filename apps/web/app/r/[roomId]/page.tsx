import { BoardLoader } from '@/board/BoardLoader';

export default async function RoomPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  return <BoardLoader roomId={roomId} />;
}

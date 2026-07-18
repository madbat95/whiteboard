import { BoardClient } from "./board-client";

export default function BoardPage({ params }: { params: { roomId: string } }) {
  return <BoardClient roomId={params.roomId} />;
}

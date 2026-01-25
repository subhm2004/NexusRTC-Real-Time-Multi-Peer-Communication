import { headers } from "next/headers";
import { RoomPage } from "@/components/RoomPage";

export default async function RoomRoute({
  params,
}: {
  params: Promise<{ uuid: string }>;
}) {
  const { uuid } = await params;
  if (!uuid) {
    return (
      <div className="app-wrap">
        <div className="notif notif-danger">Invalid room.</div>
      </div>
    );
  }
  const h = await headers();
  const host = h.get("host") || "localhost:3000";
  const proto = h.get("x-forwarded-proto");
  const base = proto ? `${proto}://${host}` : `http://${host}`;
  const roomLink = `${base}/room/${uuid}`;
  return <RoomPage uuid={uuid} roomLink={roomLink} />;
}

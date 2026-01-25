import { redirect } from "next/navigation";
import { randomUUID } from "crypto";

export default function RoomCreatePage() {
  redirect(`/room/${randomUUID()}`);
}

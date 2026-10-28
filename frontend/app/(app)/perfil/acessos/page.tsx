"use client";
import { AccessTab } from "../../../profile/AccessTab";
import { useSession } from "../../../session";

export default function AccessPage() {
  const { fail } = useSession();
  return <AccessTab fail={fail} />;
}

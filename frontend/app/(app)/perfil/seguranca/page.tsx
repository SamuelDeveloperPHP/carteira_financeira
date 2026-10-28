"use client";
import { SecurityTab } from "../../../profile/SecurityTab";
import { useSession } from "../../../session";

export default function ProfileSecurityPage() {
  const { fail } = useSession();
  return <SecurityTab fail={fail} />;
}

"use client";
import { BankTab } from "../../../profile/BankTab";
import { useSession } from "../../../session";

export default function BankPage() {
  const { fail } = useSession();
  return <BankTab fail={fail} />;
}

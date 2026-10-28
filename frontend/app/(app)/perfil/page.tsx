import { redirect } from "next/navigation";

// /perfil abre a primeira aba.
export default function ProfileIndex() {
  redirect("/perfil/bancario");
}

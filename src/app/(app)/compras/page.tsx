import { redirect } from "next/navigation";

// A lista de compras agora fica em Minha Casa.
export default function ComprasPage() {
  redirect("/casa");
}

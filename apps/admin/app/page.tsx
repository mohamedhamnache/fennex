import { redirect } from "next/navigation";

// Bare "/" has no page of its own; send visitors into the console, whose
// layout guard bounces to /login when there is no session.
export default function RootPage() {
  redirect("/overview");
}

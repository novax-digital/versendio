import { redirect } from "next/navigation";

// The public website/marketing presence will be built separately later —
// the app root goes straight to the dashboard (auth gate sends logged-out
// visitors to /login).
export default function RootPage() {
  redirect("/app");
}

import { redirect } from "next/navigation";

// Training plans moved into the Training section as a tab (Adam, 18 Aug
// 2026). Kept as a redirect rather than deleted: the Monday digest, the
// licence register and anything already bookmarked point here, and a dead
// link is a worse outcome than a one-line file.
export default function TrainingPlansRedirect() {
  redirect("/dashboard/training?tab=plans");
}

import { notFound } from "next/navigation";
import BenchRunner from "./runner";

/** Dev-only harness that runs the benchmark subset through the real browser engine. */
export default function BenchPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <BenchRunner />;
}

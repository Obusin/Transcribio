"use client";

import { useEffect } from "react";
import { recordFirstTouch } from "@/lib/telemetry";

/** Remembers where this browser first came from, so app usage can be tied to the post that brought people in. */
export function FirstTouch() {
  useEffect(() => {
    recordFirstTouch();
  }, []);
  return null;
}

"use client";

import { useEffect } from "react";
import { startUpdateCycle } from "@/lib/client/appUpdate";

/**
 * Mount point for the service worker. Registration and the update checks both
 * live in `appUpdate.ts` so there is a single owner for the worker lifecycle;
 * this component exists to give that lifecycle a home in the tree.
 */
export default function ServiceWorkerRegistration() {
  useEffect(() => {
    startUpdateCycle();
  }, []);

  return null;
}

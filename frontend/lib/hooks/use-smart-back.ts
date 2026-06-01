"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";

export function useSmartBack(fallbackHref: string) {
  const router = useRouter();

  return useCallback(() => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }

    router.push(fallbackHref);
  }, [fallbackHref, router]);
}

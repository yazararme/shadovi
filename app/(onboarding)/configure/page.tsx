"use client";

import { Suspense } from "react";
import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function ConfigureRedirectInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const clientId = searchParams.get("client");

  useEffect(() => {
    if (clientId) {
      router.replace(`/configure/models?client=${clientId}`);
    } else {
      router.replace("/discover");
    }
  }, [clientId, router]);

  return null;
}

export default function ConfigurePage() {
  return (
    <Suspense>
      <ConfigureRedirectInner />
    </Suspense>
  );
}

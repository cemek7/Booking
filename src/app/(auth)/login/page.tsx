"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();

  useEffect(() => {
    // Redirect legacy login route to the new Auth pages
    router.replace("/auth/signin");
  }, [router]);

  return null;
}

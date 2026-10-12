"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function SettingsPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/admin?tab=smtp");
  }, [router]);

  return (
    <div className="min-h-screen bg-[#070101] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-red-600/30 border-t-red-600 rounded-full animate-spin" />
    </div>
  );
}

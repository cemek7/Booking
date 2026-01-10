"use client";
import { useAuth } from "@/lib/supabase/auth-context";
import Button from "./button";
import GlassCard from "@/components/ui/GlassCard";

export default function Header() {
  const { user, signOut, loading } = useAuth();
  return (
    <header className="h-16">
      <GlassCard className="h-full flex items-center px-6 justify-between">
        <div className="font-semibold">Tenant Name</div>
        <div className="flex items-center gap-4">
          {user && (
            <>
              <span className="text-sm text-gray-200/90">{user.email}</span>
              <Button onClick={signOut} disabled={loading} className="ml-2 px-3 py-1 text-xs">Logout</Button>
            </>
          )}
        </div>
      </GlassCard>
    </header>
  );
}

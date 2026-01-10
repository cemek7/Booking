"use client";
import { useState } from "react";
import Input from "@/components/ui/input";
import Button from "@/components/ui/button";
import { useTenant } from "@/lib/supabase/tenant-context";
import { authPost } from "@/lib/auth/auth-api-client";

export default function InviteStaffForm() {
  const { tenant } = useTenant();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(false);
    try {
      const response = await authPost("/api/invite-staff", { email, tenant_id: tenant?.id });
      if (response.error) throw new Error("Failed to send invite");
      setSuccess(true);
      setEmail("");
    } catch (err: any) {
      setError(err.message || "Error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleInvite} className="space-y-4 max-w-md bg-white p-4 rounded shadow">
      <h2 className="text-lg font-bold">Invite Staff</h2>
      <div>
        <label className="block mb-1">Staff Email</label>
        <Input type="email" value={email} onChange={e => setEmail(e.target.value)} required />
      </div>
      {error && <div className="text-red-500 text-sm">{error}</div>}
      {success && <div className="text-green-600 text-sm">Invite sent! The staff member will receive a magic link to join.</div>}
      <Button type="submit" disabled={loading}>{loading ? "Sending..." : "Send Invite"}</Button>
    </form>
  );
}

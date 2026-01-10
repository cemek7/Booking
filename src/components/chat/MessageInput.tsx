"use client";
import { useState } from "react";
import { useTenant } from "@/lib/supabase/tenant-context";
import { authPost } from "@/lib/auth/auth-api-client";

export default function MessageInput({ customerId, onSent }: { customerId: string; onSent?: () => void }) {
  const { tenant } = useTenant();
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await authPost("/api/chat", { 
        customer_id: customerId, 
        message 
      });
      if (response.error) throw new Error(response.error.message);
      setMessage("");
      if (onSent) onSent();
    } catch (err: any) {
      setError(err.message || "Error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSend} className="flex gap-2 mt-2">
      <input
        className="flex-1 border rounded px-3 py-2"
        placeholder="Type a message..."
        value={message}
        onChange={e => setMessage(e.target.value)}
        disabled={loading}
        required
      />
      <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded" disabled={loading}>
        {loading ? "Sending..." : "Send"}
      </button>
      {error && <div className="text-red-500 text-xs ml-2">{error}</div>}
    </form>
  );
}

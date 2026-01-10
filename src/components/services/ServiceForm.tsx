"use client";
import { useState, useEffect } from "react";
import Input from "../ui/input";
import Button from "../ui/button";
import { useTenant } from "@/lib/supabase/tenant-context";
import { authPost, authPatch } from "@/lib/auth/auth-api-client";

export default function ServiceForm({ onSuccess, initialData }: { onSuccess?: () => void; initialData?: any }) {
  const { tenant } = useTenant();
  const [name, setName] = useState(initialData?.name || "");
  const [description, setDescription] = useState(initialData?.description || "");
  const [price, setPrice] = useState(initialData?.price || "");
  const [duration, setDuration] = useState(initialData?.duration || "");
  const [category, setCategory] = useState(initialData?.category || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialData) {
      setName(initialData.name || "");
      setDescription(initialData.description || "");
      setPrice(initialData.price || "");
      setDuration(initialData.duration || "");
      setCategory(initialData.category || "");
    }
  }, [initialData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      let response;
      const payload = { name, description, price, duration, category };
      if (initialData && initialData.id) {
        response = await authPatch(`/api/services?id=eq.${initialData.id}`, payload);
      } else {
        response = await authPost("/api/services", payload);
      }
      if (response.error) throw new Error(initialData ? "Failed to update service" : "Failed to create service");
      if (!initialData) {
        setName("");
        setDescription("");
        setPrice("");
        setDuration("");
        setCategory("");
      }
      if (typeof onSuccess === "function") onSuccess();
    } catch (err: any) {
      setError(err.message || "Error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-md bg-white p-4 rounded shadow">
      <h2 className="text-lg font-bold">{initialData ? "Edit Service" : "New Service"}</h2>
      <div>
        <label className="block mb-1">Name</label>
        <Input value={name} onChange={e => setName(e.target.value)} required />
      </div>
      <div>
        <label className="block mb-1">Description</label>
        <Input value={description} onChange={e => setDescription(e.target.value)} />
      </div>
      <div>
        <label className="block mb-1">Price</label>
        <Input type="number" min={0} value={price} onChange={e => setPrice(e.target.value)} required />
      </div>
      <div>
        <label className="block mb-1">Duration (minutes)</label>
        <Input type="number" min={0} value={duration} onChange={e => setDuration(e.target.value)} required />
      </div>
      <div>
        <label className="block mb-1">Category</label>
        <Input value={category} onChange={e => setCategory(e.target.value)} />
      </div>
      {error && <div className="text-red-500 text-sm">{error}</div>}
      <Button type="submit" disabled={loading}>{loading ? "Saving..." : initialData ? "Update Service" : "Create Service"}</Button>
    </form>
  );
}

"use client";
import { useState, useEffect } from "react";
import Input from "../ui/input";
import Button from "../ui/button";
import { useTenant } from "@/lib/supabase/tenant-context";
import { authPost, authPatch } from "@/lib/auth/auth-api-client";

type BookingData = {
  id?: string;
  title?: string;
  description?: string;
  capacity?: number;
  start_date?: string;
  end_date?: string;
  status?: string;
};

interface BookingFormProps {
  initialData?: BookingData;
  onSuccess?: () => void;
}

const BookingForm: React.FC<BookingFormProps> = ({ initialData, onSuccess }) => {
  const { tenant } = useTenant();
  const [title, setTitle] = useState(initialData?.title || "");
  const [description, setDescription] = useState(initialData?.description || "");
  const [capacity, setCapacity] = useState(initialData?.capacity || 1);
  const [startDate, setStartDate] = useState(initialData?.start_date || "");
  const [endDate, setEndDate] = useState(initialData?.end_date || "");
  const [status, setStatus] = useState(initialData?.status || "open");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialData) {
      setTitle(initialData.title || "");
      setDescription(initialData.description || "");
      setCapacity(initialData.capacity || 1);
      setStartDate(initialData.start_date || "");
      setEndDate(initialData.end_date || "");
      setStatus(initialData.status || "open");
    }
  }, [initialData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      let response;
      const payload = { title, description, capacity, start_date: startDate, end_date: endDate, status };
      if (initialData && initialData.id) {
        response = await authPatch(`/api/bookings?id=eq.${initialData.id}`, payload);
      } else {
        response = await authPost("/api/bookings", payload);
      }
      if (response.error) throw new Error(initialData ? "Failed to update booking" : "Failed to create booking");
      if (!initialData) {
        setTitle("");
        setDescription("");
        setCapacity(1);
        setStartDate("");
        setEndDate("");
        setStatus("open");
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
      <h2 className="text-lg font-bold">{initialData ? "Edit Booking" : "New Booking"}</h2>
      <div>
        <label className="block mb-1">Title</label>
        <Input value={title} onChange={e => setTitle(e.target.value)} required />
      </div>
      <div>
        <label className="block mb-1">Description</label>
        <Input value={description} onChange={e => setDescription(e.target.value)} />
      </div>
      <div>
        <label className="block mb-1">Capacity</label>
        <Input type="number" min={1} value={capacity} onChange={e => setCapacity(Number(e.target.value))} required />
      </div>
      <div>
        <label className="block mb-1">Start Date</label>
        <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} required />
      </div>
      <div>
        <label className="block mb-1">End Date</label>
        <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} required />
      </div>
      <div>
        <label className="block mb-1">Status</label>
        <select value={status} onChange={e => setStatus(e.target.value)} className="w-full border rounded px-3 py-2">
          <option value="open">Open</option>
          <option value="full">Full</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>
      {error && <div className="text-red-500 text-sm">{error}</div>}
      <Button type="submit" disabled={loading}>{loading ? "Saving..." : initialData ? "Update Booking" : "Create Booking"}</Button>
    </form>
  );
};

export default BookingForm;

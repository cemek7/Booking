"use client";
import React, { useState, useEffect } from "react";
import Input from "../ui/input";
import Button from "../ui/button";
import { useTenant } from "@/lib/supabase/tenant-context";
import { authPost, authPatch } from "@/lib/auth/auth-api-client";

type Customer = {
  id?: string;
  name?: string;
  email?: string;
  phone?: string;
};

interface CustomerFormProps {
  tenantId?: string;
  onSuccess: () => void;
  initialData?: Customer;
}

const CustomerForm: React.FC<CustomerFormProps> = ({ initialData, onSuccess }) => {
  const { tenant } = useTenant();
  const [name, setName] = useState(initialData?.name || "");
  const [email, setEmail] = useState(initialData?.email || "");
  const [phone, setPhone] = useState(initialData?.phone || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialData) {
      setName(initialData.name || "");
      setEmail(initialData.email || "");
      setPhone(initialData.phone || "");
    }
  }, [initialData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      let response;
      const payload = { name, email, phone };
      if (initialData && initialData.id) {
        response = await authPatch(`/api/customers?id=eq.${initialData.id}`, payload);
      } else {
        response = await authPost("/api/customers", payload);
      }
      if (response.error) throw new Error(initialData ? "Failed to update customer" : "Failed to create customer");
      if (onSuccess) onSuccess();
    } catch (err: any) {
      setError(err.message || "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div>
        <label className="block mb-1">Name</label>
        <Input value={name} onChange={e => setName(e.target.value)} required />
      </div>
      <div>
        <label className="block mb-1">Email</label>
        <Input type="email" value={email} onChange={e => setEmail(e.target.value)} required />
      </div>
      <div>
        <label className="block mb-1">Phone</label>
        <Input value={phone} onChange={e => setPhone(e.target.value)} />
      </div>
      {error && <div className="text-red-500 text-sm">{error}</div>}
      <Button type="submit" disabled={loading}>
        {loading ? "Saving..." : initialData ? "Update Customer" : "Create Customer"}
      </Button>
    </form>
  );
};

export default CustomerForm;

"use client";
import { useState, useEffect, useRef } from "react";
import { toast } from "../ui/toast";
import { useTenant } from "@/lib/supabase/tenant-context";
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Input from "../ui/input";
import Button from "../ui/button";
import Modal from "../ui/modal";
import StaffSelect from "./StaffSelect";
import ServicesMultiSelect from "./ServicesMultiSelect";
import { authFetch, authPost, authPatch } from "@/lib/auth/auth-api-client";

export default function ReservationForm(props: { onSuccess?: () => void; initialData?: any }) {
  const { tenant } = useTenant();
  const { onSuccess, initialData } = props;
  const customerSelectRef = useRef<HTMLSelectElement | null>(null);
  const dateInputRef = useRef<HTMLInputElement | null>(null);
  const addCustomerNameRef = useRef<HTMLInputElement | null>(null);
  const mountedRef = useRef(false);
  const [status, setStatus] = useState(initialData?.status || "pending");
  const [customerId, setCustomerId] = useState(initialData?.customer_id || "");
  const [notes, setNotes] = useState(initialData?.notes || "");
  const [staffId, setStaffId] = useState(initialData?.staff_id || "");
  const [services, setServices] = useState<{ id: string, quantity: number }[]>(initialData?.services || []);
  const [date, setDate] = useState(initialData?.start_time ? initialData.start_time.slice(0, 16) : (initialData?.date ? initialData.date.slice(0, 16) : ""));
  const [bookingId, setBookingId] = useState(initialData?.booking_id || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  const customersQuery = useQuery({
    queryKey: ['customers', tenant?.id],
    queryFn: async () => {
      if (!tenant?.id) return [];
      const response = await authFetch('/api/customers');
      if (response.error) throw new Error('Failed customers fetch');
      return response.data || [];
    },
    enabled: !!tenant?.id
  });
  const customers = customersQuery.data;
  const loadingCustomers = customersQuery.isLoading;
  // Auto-open add-customer modal if there are no customers (first mount)
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      if (!loadingCustomers && Array.isArray(customers) && customers.length === 0) {
        if (initialData?.prefillPhone) setNewCustomerPhone(initialData.prefillPhone);
        setShowAddCustomer(true);
        setTimeout(() => addCustomerNameRef.current?.focus(), 50);
      }
    }
  }, [loadingCustomers, customers, initialData]);
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");
  const [addCustomerLoading, setAddCustomerLoading] = useState(false);
  const [addCustomerError, setAddCustomerError] = useState<string | null>(null);
  // Bookings for group events
  const bookingsQuery = useQuery({
    queryKey: ['bookings-list', tenant?.id],
    queryFn: async () => {
      if (!tenant?.id) return [];
      const response = await authFetch('/api/bookings');
      if (response.error) throw new Error('Failed bookings fetch');
      return response.data || [];
    },
    enabled: !!tenant?.id
  });
  const bookings = bookingsQuery.data;
  const loadingBookings = bookingsQuery.isLoading;

  useEffect(() => {
    if (initialData) {
      setStatus(initialData.status || "pending");
      setCustomerId(initialData.customer_id || "");
      setNotes(initialData.notes || "");
      setStaffId(initialData.staff_id || "");
      setServices(initialData.services || []);
      setDate(initialData.date ? initialData.date.slice(0, 16) : "");
      setBookingId(initialData.booking_id || "");
    }
    // Focus date/time input when form mounts or initialData changes
    try {
      setTimeout(() => {
        dateInputRef.current?.focus();
      }, 0);
    } catch (e) {}
  }, [initialData]);

  const addCustomerMutation = useMutation({
    mutationFn: async (payload: { name: string; phone: string }) => {
      const response = await authPost('/api/customers', payload);
      if (response.error) throw new Error('Failed to add customer');
      return response.data;
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['customers', tenant?.id] });
      setShowAddCustomer(false);
      setNewCustomerName('');
      setNewCustomerPhone('');
      setCustomerId(data.id || (data[0] && data[0].id) || '');
    },
    onError: (err: any) => setAddCustomerError(err.message || 'Error'),
    onSettled: () => setAddCustomerLoading(false)
  });

  const handleAddCustomer = (e?: React.FormEvent) => {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    setAddCustomerLoading(true);
    setAddCustomerError(null);
    addCustomerMutation.mutate({ name: newCustomerName, phone: newCustomerPhone });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      let response;
      const reservationPayload = {
        status,
        customer_id: customerId,
        notes,
        staff_id: staffId || null,
        date: date ? new Date(date).toISOString() : null,
        booking_id: bookingId || null,
      };
      if (initialData && initialData.id) {
        // Update existing reservation
        response = await authPatch(`/api/reservations?id=eq.${initialData.id}`, reservationPayload);
      } else {
        // Create new reservation
        response = await authPost("/api/reservations", reservationPayload);
      }
      if (response.error) throw new Error(initialData ? "Failed to update reservation" : "Failed to create reservation");
      // Save reservation services (many-to-many)
      const reservation = response.data;
      const reservationId = initialData?.id || reservation?.id || (reservation?.[0] && reservation[0].id);
      if (reservationId && services.length > 0) {
        await authPost(`/api/reservations/${reservationId}/services`, { services });
      }
      if (!initialData) {
        setStatus("pending");
        setCustomerId("");
        setNotes("");
        setStaffId("");
        setServices([]);
        setDate("");
        setBookingId("");
      }
  if (typeof onSuccess === "function") onSuccess();
  toast.success(initialData ? "Reservation updated!" : "Reservation created!");
    } catch (err: any) {
      setError(err.message || "Error");
      toast.error(err.message || "Error");
    } finally {
      setLoading(false);
    }
  };

  const [resendLoading, setResendLoading] = useState(false);
  const handleResendCalendar = async () => {
    if (!initialData || !initialData.id) return;
    setResendLoading(true);
    try {
      const response = await authPost(`/api/reservations/${initialData.id}/send-calendar`, {});
      if (response.error) throw new Error('Failed to send calendar link');
      toast.success('Calendar link sent');
    } catch (err: any) {
      toast.error(err?.message || 'Error sending calendar link');
    } finally {
      setResendLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-md bg-white p-4 rounded shadow">
      <h2 className="text-lg font-bold">{initialData ? "Edit Reservation" : "New Reservation"}</h2>
      <div>
        <label className="block mb-1">Status</label>
        <select value={status} onChange={e => setStatus(e.target.value)} className="w-full border rounded px-3 py-2">
          <option value="pending">Pending</option>
          <option value="confirmed">Confirmed</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>
      <div>
        <label className="block mb-1">Customer</label>
        <div className="flex gap-2">
          <select
            ref={customerSelectRef}
            value={customerId}
            onChange={e => setCustomerId(e.target.value)}
            required
            className="w-full border rounded px-3 py-2"
          >
            <option value="" disabled>
              {loadingCustomers ? "Loading customers..." : "Select a customer"}
            </option>
            {customers && customers.map((c: any) => (
              <option key={c.id} value={c.id}>
                {c.name || c.phone || c.id}
              </option>
            ))}
          </select>
          <Button type="button" onClick={() => setShowAddCustomer(true)} className="px-2 py-1 text-xs">+ Add</Button>
        </div>
        <Modal open={showAddCustomer} onClose={() => setShowAddCustomer(false)}>
          <div className="space-y-3">
            <h3 className="font-bold mb-2">Add Customer</h3>
            <Input
              placeholder="Name"
              ref={addCustomerNameRef}
              value={newCustomerName}
              onChange={e => setNewCustomerName(e.target.value)}
              required
            />
            <Input
              placeholder="Phone"
              value={newCustomerPhone}
              onChange={e => setNewCustomerPhone(e.target.value)}
              required
            />
            {addCustomerError && <div className="text-red-500 text-sm">{addCustomerError}</div>}
            <div className="flex gap-2 justify-end">
              <Button type="button" onClick={() => setShowAddCustomer(false)} className="px-3 py-1 text-xs" disabled={addCustomerLoading}>Cancel</Button>
              <Button type="button" onClick={() => handleAddCustomer()} className="px-3 py-1 text-xs" disabled={addCustomerLoading}>{addCustomerLoading ? "Adding..." : "Add"}</Button>
            </div>
          </div>
        </Modal>
      </div>
      <div>
        <label className="block mb-1">Staff</label>
        <StaffSelect value={staffId} onChange={setStaffId} />
      </div>
      <div>
        <label className="block mb-1">Date & Time</label>
        <input ref={dateInputRef} type="datetime-local" value={date} onChange={e => setDate(e.target.value)} className="w-full border rounded px-3 py-2" />
      </div>
      <div>
        <label className="block mb-1">Services</label>
        <ServicesMultiSelect value={services} onChange={setServices} />
      </div>
      <div>
        <label className="block mb-1">Booking (optional)</label>
        <select value={bookingId} onChange={e => setBookingId(e.target.value)} className="w-full border rounded px-3 py-2">
          <option value="">None</option>
          {bookings && bookings.map((b: any) => (
            <option key={b.id} value={b.id}>{b.title || b.id}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block mb-1">Notes</label>
        <Input value={notes} onChange={e => setNotes(e.target.value)} />
      </div>
      {error && <div className="text-red-500 text-sm">{error}</div>}
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={loading}>{loading ? "Saving..." : initialData ? "Update Reservation" : "Create Reservation"}</Button>
        {initialData?.id && (
          <Button type="button" onClick={handleResendCalendar} disabled={resendLoading} className="bg-gray-100 text-gray-800 hover:bg-gray-200">
            {resendLoading ? 'Sending...' : 'Send Calendar Link Again'}
          </Button>
        )}
      </div>
    </form>
  );
}

// ...existing code...

export async function getReservations(tenantId: string) {
  const url = `/api/reservations${tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : ""}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch reservations");
  return res.json();
}

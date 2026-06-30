import Link from "next/link";
import { usePathname } from "next/navigation";
import GlassCard from "@/components/ui/GlassCard";

const nav = [
  { href: "/dashboard/superadmin", label: "Overview" },
  { href: "/dashboard/superadmin/support", label: "Support" },
  { href: "/dashboard/superadmin/tenants", label: "Tenants" },
  { href: "/dashboard/superadmin/analytics", label: "Analytics" },
  { href: "/dashboard/superadmin/reservations", label: "Reservations" },
  { href: "/dashboard/superadmin/reservation-logs", label: "Audit Logs" },
];

export default function SuperSidebar() {
  const pathname = usePathname();
  return (
    <aside className="w-64">
      <GlassCard className="flex flex-col min-h-screen p-0">
        <div className="h-16 flex items-center justify-center font-extrabold text-xl text-primary tracking-tight border-b border-white/6">
          Admin
        </div>
        <nav className="flex-1 py-6 px-4 space-y-2">
          {nav.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={`block px-4 py-2 rounded-lg font-medium transition-colors ${
                pathname === href
                  ? "bg-primary text-white shadow"
                  : "text-gray-200/90 hover:bg-white/2"
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>
      </GlassCard>
    </aside>
  );
}

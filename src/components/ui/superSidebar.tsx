import Link from "next/link";
import { usePathname } from "next/navigation";
import GlassCard from "@/components/ui/GlassCard";

const nav = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/tenants", label: "Tenants" },
  { href: "/admin/usage", label: "Usage" },
  { href: "/admin/support", label: "Support" },
  { href: "/admin/settings", label: "Settings" },
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

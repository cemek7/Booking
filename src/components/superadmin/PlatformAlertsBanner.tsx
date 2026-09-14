"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { authFetch } from "@/lib/auth/auth-api-client";

/**
 * Puts the silent failures where they cannot be ignored.
 *
 * Every alert here describes something that breaks nothing and throws nothing:
 * an unpaid Meta account, a rate card nobody confirmed, a naira rate months
 * old. The first natural signal for any of them is lost margin or silent
 * tenants, so the dashboard has to be the signal instead.
 *
 * Deliberately NOT dismissible. These are states, not events — the banner goes
 * away when the underlying thing is fixed, and not before.
 */

type Severity = "critical" | "warning" | "info";

interface PlatformAlert {
  id: string;
  severity: Severity;
  title: string;
  message: string;
  action?: string;
}

const STYLES: Record<Severity, { wrap: string; chip: string; icon: string }> = {
  critical: {
    wrap: "border-rose-300 bg-rose-50",
    chip: "bg-rose-600 text-white",
    icon: "text-rose-600",
  },
  warning: {
    wrap: "border-amber-300 bg-amber-50",
    chip: "bg-amber-500 text-white",
    icon: "text-amber-600",
  },
  info: {
    wrap: "border-slate-200 bg-slate-50",
    chip: "bg-slate-500 text-white",
    icon: "text-slate-500",
  },
};

export default function PlatformAlertsBanner() {
  const [alerts, setAlerts] = useState<PlatformAlert[]>([]);

  useEffect(() => {
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- state is set after an await, not synchronously in the effect body; this is mount-time data loading
    authFetch<{ alerts?: PlatformAlert[] }>("/api/superadmin/platform-alerts")
      .then((res) => {
        if (!active || res.error) return;
        setAlerts(
          (res.data as { alerts?: PlatformAlert[] } | null)?.alerts ?? [],
        );
      })
      .catch(() => {
        /* the dashboard must still render without this */
      });
    return () => {
      active = false;
    };
  }, []);

  if (alerts.length === 0) return null;

  return (
    <section aria-label="Platform alerts" className="space-y-3">
      {alerts.map((alert) => {
        const s = STYLES[alert.severity] ?? STYLES.info;
        return (
          <div
            key={alert.id}
            data-testid={`platform-alert-${alert.id}`}
            role={alert.severity === "critical" ? "alert" : "status"}
            className={`flex flex-col gap-2 rounded-2xl border-2 p-4 shadow-sm sm:flex-row sm:items-start sm:gap-4 ${s.wrap}`}
          >
            {alert.severity === "info" ? (
              <Info className={`h-5 w-5 shrink-0 ${s.icon}`} aria-hidden />
            ) : (
              <AlertTriangle
                className={`h-5 w-5 shrink-0 ${s.icon}`}
                aria-hidden
              />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${s.chip}`}
                >
                  {alert.severity}
                </span>
                <h3 className="text-sm font-semibold text-slate-900">
                  {alert.title}
                </h3>
              </div>
              <p className="mt-1 text-sm text-slate-700">{alert.message}</p>
              {alert.action && (
                <p className="mt-2 text-sm font-medium text-slate-900">
                  {alert.action}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
}

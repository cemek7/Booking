const LEGACY_DASHBOARD_PREFIX = '/dashboard';
const BOOKA_DASHBOARD_PREFIX = '/booka/dashboard';

export function toBookaDashboardPath(pathname: string): string {
  if (pathname === LEGACY_DASHBOARD_PREFIX || pathname.startsWith(`${LEGACY_DASHBOARD_PREFIX}/`)) {
    return `${BOOKA_DASHBOARD_PREFIX}${pathname.slice(LEGACY_DASHBOARD_PREFIX.length)}`;
  }
  return pathname;
}

export function toInternalDashboardPath(pathname: string): string {
  if (pathname === BOOKA_DASHBOARD_PREFIX || pathname.startsWith(`${BOOKA_DASHBOARD_PREFIX}/`)) {
    return `${LEGACY_DASHBOARD_PREFIX}${pathname.slice(BOOKA_DASHBOARD_PREFIX.length)}`;
  }
  return pathname;
}

export function isBookaDashboardPath(pathname: string): boolean {
  return pathname === BOOKA_DASHBOARD_PREFIX || pathname.startsWith(`${BOOKA_DASHBOARD_PREFIX}/`);
}

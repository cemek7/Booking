// @ts-nocheck — zustand not yet installed (package.json has ^5.0.8 but npm install pending)
// TODO: after `npm install`, change to: import { create } from "zustand";
import { create } from "zustand";

type AppState = {
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  setSidebar: (open: boolean) => void;
};

export const useAppStore = create<AppState>((set) => ({
  sidebarOpen: false,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebar: (open: boolean) => set(() => ({ sidebarOpen: open })),
}));

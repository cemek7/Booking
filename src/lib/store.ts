import create from "zustand";

type User = {
  id?: string;
  email?: string;
};

type AuthState = {
  user: User | null;
  setUser: (u: User | null) => void;
  clearUser: () => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  setUser: (user) => set({ user }),
  clearUser: () => set({ user: null }),
}));

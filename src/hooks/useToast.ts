import { useCallback } from 'react';

interface ToastProps {
  title: string;
  description?: string;
  type?: 'success' | 'error' | 'info' | 'warning';
  duration?: number;
}

/**
 * Hook for displaying toast notifications
 * Uses browser's native alert if no UI framework available
 */
export function useToast() {
  const toast = useCallback(({ title, description, type = 'info' }: ToastProps) => {
    // Simple implementation - can be replaced with proper toast library
    const message = description ? `${title}\n${description}` : title;
    
    if (type === 'error') {
      console.error(message);
    } else if (type === 'success') {
      console.log(message);
    }
    
    // Use window.alert for now - can be replaced with proper UI component
    if (typeof window !== 'undefined') {
      // You can add a proper toast UI here using a library like react-toastify
      // For now, we'll just log to console to avoid blocking UI
      console.log({ title, description, type });
    }
  }, []);

  return { toast };
}

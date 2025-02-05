import { toast } from '@/components/ui/use-toast';
import type { ToastActionElement } from '@/components/ui/toast';

type ToastProps = {
  title?: string;
  description?: string;
  variant?: 'default' | 'destructive';
  duration?: number;
  action?: ToastActionElement;
};

export type ToastReturn = ReturnType<typeof toast>;

// Keep track of active toasts
const activeToasts = new Map<string, ToastReturn>();

export const toastService = {
  show(options: ToastProps): ToastReturn {
    const toastInstance = toast(options);
    activeToasts.set(toastInstance.id, toastInstance);
    return toastInstance;
  },

  update(toastId: string, options: ToastProps) {
    const existingToast = activeToasts.get(toastId);
    if (existingToast) {
      existingToast.update({
        ...options,
        id: toastId,
      });
      return existingToast;
    }
    return this.show(options);
  },

  dismiss(toastId: string) {
    const existingToast = activeToasts.get(toastId);
    if (existingToast) {
      existingToast.dismiss();
      activeToasts.delete(toastId);
    }
  },

  success(message: string, options: Partial<ToastProps> = {}) {
    return this.show({
      title: "Success",
      description: message,
      variant: "default",
      duration: 3000,
      ...options,
    });
  },

  error(message: string, options: Partial<ToastProps> = {}) {
    return this.show({
      title: "Error",
      description: message,
      variant: "destructive",
      duration: 5000,
      ...options,
    });
  },

  progress(title: string, progress: number, options: Partial<ToastProps> = {}) {
    return this.show({
      title,
      description: `${Math.round(progress)}%`,
      duration: Infinity,
      ...options,
    });
  },
}; 
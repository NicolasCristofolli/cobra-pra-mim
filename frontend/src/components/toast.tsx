'use client';

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode
} from 'react';
import { CheckCircle2, Info, XCircle } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info';

interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
  action?: ToastAction;
}

const ToastContext = createContext<{
  push: (type: ToastType, message: string, action?: ToastAction) => void;
} | null>(null);

// Toast escuro do design: fundo verde-preto, ícone colorido por tom.
const ICON = {
  success: { Icon: CheckCircle2, cls: 'text-leaf-400' },
  error: { Icon: XCircle, cls: 'text-danger-500' },
  info: { Icon: Info, cls: 'text-primary-300' }
} as const;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const push = useCallback((type: ToastType, message: string, action?: ToastAction) => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, type, message, action }]);
    setTimeout(
      () => setToasts((current) => current.filter((toast) => toast.id !== id)),
      action ? 8000 : 4200
    );
  }, []);

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed bottom-6 right-6 z-[60] flex w-full max-w-sm flex-col gap-2">
        {toasts.map((toast) => {
          const { Icon, cls } = ICON[toast.type];
          return (
            <div
              key={toast.id}
              className="pointer-events-auto flex items-start gap-2.5 rounded-xl bg-ink px-4 py-3.5 text-[13.5px] font-semibold text-sand-50 shadow-float animate-toast-in"
            >
              <Icon className={`mt-0.5 h-[17px] w-[17px] shrink-0 ${cls}`} />
              <p className="flex-1 leading-snug">{toast.message}</p>
              {toast.action && (
                <button
                  type="button"
                  onClick={() => {
                    toast.action!.onClick();
                    setToasts((current) => current.filter((t) => t.id !== toast.id));
                  }}
                  className="shrink-0 rounded-lg px-1.5 py-0.5 font-bold text-primary-300 underline-offset-2 hover:underline"
                >
                  {toast.action.label}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast precisa estar dentro de <ToastProvider>');
  return context;
}

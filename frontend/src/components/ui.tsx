'use client';

import { X, Loader2, type LucideIcon } from 'lucide-react';
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes
} from 'react';
import type { ChargeStatus, ClientStatus } from '@/lib/types';

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/* ---------------- Botão ---------------- */

type ButtonVariant = 'primary' | 'accent' | 'outline' | 'ghost' | 'danger';

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary:
    'bg-primary-500 text-sand-50 hover:bg-primary-600 active:bg-primary-700 focus-visible:ring-leaf-500 shadow-sm',
  accent:
    'bg-leaf-500 text-sand-950 hover:bg-leaf-600 active:bg-leaf-700 focus-visible:ring-leaf-500 shadow-sm',
  outline:
    'border border-sand-200 bg-white text-sand-900 hover:border-sand-300 hover:bg-sand-50 focus-visible:ring-leaf-500',
  ghost: 'text-sand-600 hover:bg-sand-900/5 hover:text-sand-900 focus-visible:ring-leaf-500',
  danger:
    'bg-danger-600 text-white hover:bg-danger-700 focus-visible:ring-danger-500 shadow-sm'
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-60',
        size === 'sm'
          ? 'px-3 py-1.5 text-[13px]'
          : size === 'lg'
            ? 'px-5 py-3 text-[15px]'
            : 'px-4 py-2 text-sm',
        BUTTON_VARIANT[variant],
        className
      )}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

/** Botão só-ícone das linhas de tabela e cabeçalhos de card. */
export function IconButton({
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={cx(
        'rounded-lg p-2 text-sand-400 transition-colors hover:bg-sand-50 hover:text-primary-600',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf-500',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
    >
      {children}
    </button>
  );
}

/* ---------------- Campos ---------------- */

interface FieldProps {
  label?: string;
  error?: string | null;
  hint?: string;
  children: ReactNode;
}

export function Field({ label, error, hint, children }: FieldProps) {
  return (
    <label className="block">
      {label && (
        <span className="mb-1.5 block text-[13px] font-semibold text-sand-900">{label}</span>
      )}
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-sand-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-danger-600">{error}</span>}
    </label>
  );
}

const FIELD_BASE =
  'w-full rounded-xl border border-sand-200 bg-white px-3.5 py-2.5 text-sm font-medium text-sand-900 placeholder:text-sand-400 focus:border-leaf-500 focus:outline-none focus:shadow-focus disabled:bg-sand-50';

export function Input({
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cx(FIELD_BASE, className)} />;
}

/** Input com ícone à esquerda (barras de busca do design). */
export function IconInput({
  icon: Icon,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { icon: LucideIcon }) {
  return (
    <div className={cx('relative', className)}>
      <Icon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-sand-400" />
      <input {...rest} className={cx(FIELD_BASE, 'pl-10')} />
    </div>
  );
}

export function Select({
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={cx(FIELD_BASE, 'pr-8', className)}>
      {children}
    </select>
  );
}

export function Textarea({
  className,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cx(FIELD_BASE, 'leading-relaxed', className)} />;
}

/* ---------------- Card ---------------- */

export function Card({
  className,
  children
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cx('rounded-2xl border border-sand-200/70 bg-white shadow-card', className)}>
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  action
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-sand-100 px-5 py-4">
      <div>
        <h2 className="text-[15px] font-bold tracking-tight text-sand-900">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-sand-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/* ---------------- Avatar de iniciais ---------------- */

const AVATAR_PALETTE = [
  'bg-primary-100 text-primary-700',
  'bg-leaf-100 text-leaf-800',
  'bg-flame-100 text-flame-700',
  'bg-sand-200 text-sand-700'
] as const;

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
}

export function Avatar({
  name,
  size = 'md',
  className
}: {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return (
    <span
      className={cx(
        'flex shrink-0 items-center justify-center rounded-full font-bold',
        size === 'sm' ? 'h-8 w-8 text-[11px]' : size === 'lg' ? 'h-14 w-14 text-lg' : 'h-11 w-11 text-sm',
        AVATAR_PALETTE[hash % AVATAR_PALETTE.length],
        className
      )}
    >
      {initialsOf(name)}
    </span>
  );
}

/* ---------------- Badges ---------------- */

export type BadgeVariant = 'success' | 'warning' | 'danger' | 'neutral' | 'brand';

const BADGE_VARIANT: Record<BadgeVariant, string> = {
  success: 'bg-leaf-50 text-leaf-700 ring-leaf-600/20',
  warning: 'bg-flame-50 text-flame-600 ring-flame-500/25',
  danger: 'bg-danger-50 text-danger-600 ring-danger-500/20',
  neutral: 'bg-sand-50 text-sand-600 ring-sand-400/25',
  brand: 'bg-primary-50 text-primary-700 ring-primary-500/25'
};

export function Badge({
  variant = 'neutral',
  className,
  children
}: {
  variant?: BadgeVariant;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset',
        BADGE_VARIANT[variant],
        className
      )}
    >
      {children}
    </span>
  );
}

const CHARGE_BADGE: Record<ChargeStatus, { label: string; variant: BadgeVariant }> = {
  PAID: { label: 'Paga', variant: 'success' },
  PENDING: { label: 'Em aberto', variant: 'warning' },
  SENT: { label: 'Enviada', variant: 'brand' },
  OVERDUE: { label: 'Vencida', variant: 'danger' },
  CANCELED: { label: 'Cancelada', variant: 'neutral' }
};

export function ChargeBadge({ status }: { status: ChargeStatus }) {
  const { label, variant } = CHARGE_BADGE[status];
  return <Badge variant={variant}>{label}</Badge>;
}

const CLIENT_BADGE: Record<ClientStatus, { label: string; variant: BadgeVariant }> = {
  ADIMPLENTE: { label: 'Em dia', variant: 'success' },
  INADIMPLENTE: { label: 'Inadimplente', variant: 'danger' },
  SEM_COBRANCAS: { label: 'Sem cobrança', variant: 'neutral' }
};

export function ClientBadge({ status }: { status: ClientStatus }) {
  const { label, variant } = CLIENT_BADGE[status];
  return <Badge variant={variant}>{label}</Badge>;
}

/** Chip clicável de filtro, colorido conforme o status que representa. */
const CHIP_VARIANT: Record<BadgeVariant, { active: string; inactive: string; dot: string }> = {
  success: {
    active: 'bg-leaf-600 text-white ring-leaf-600',
    inactive: 'bg-leaf-50 text-leaf-700 ring-leaf-600/25 hover:bg-leaf-100',
    dot: 'bg-leaf-600'
  },
  warning: {
    active: 'bg-flame-500 text-white ring-flame-500',
    inactive: 'bg-flame-50 text-flame-600 ring-flame-500/30 hover:bg-flame-100',
    dot: 'bg-flame-500'
  },
  danger: {
    active: 'bg-danger-600 text-white ring-danger-600',
    inactive: 'bg-danger-50 text-danger-600 ring-danger-500/25 hover:bg-danger-100',
    dot: 'bg-danger-500'
  },
  neutral: {
    active: 'bg-sand-600 text-white ring-sand-600',
    inactive: 'bg-sand-50 text-sand-600 ring-sand-400/30 hover:bg-sand-100',
    dot: 'bg-sand-400'
  },
  brand: {
    active: 'bg-primary-500 text-sand-50 ring-primary-500',
    inactive: 'bg-primary-50 text-primary-700 ring-primary-500/25 hover:bg-primary-100',
    dot: 'bg-primary-500'
  }
};

export function FilterChip({
  active,
  onClick,
  variant = 'brand',
  children
}: {
  active: boolean;
  onClick: () => void;
  variant?: BadgeVariant;
  children: ReactNode;
}) {
  const styles = CHIP_VARIANT[variant];
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold ring-1 ring-inset transition-colors',
        active ? styles.active : styles.inactive
      )}
    >
      <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', active ? 'bg-white/80' : styles.dot)} />
      {children}
    </button>
  );
}

/* ---------------- Modal ---------------- */

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}

export function Modal({ open, onClose, title, subtitle, children, footer, wide }: ModalProps) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-sand-900/50 p-4 animate-fade-in"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={cx(
          'my-8 w-full rounded-2xl bg-white shadow-float animate-pop-in',
          wide ? 'max-w-2xl' : 'max-w-lg'
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-sand-100 px-6 py-5">
          <div>
            <h3 className="text-lg font-bold tracking-tight text-sand-900">{title}</h3>
            {subtitle && <p className="mt-0.5 text-sm text-sand-500">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-sand-400 hover:bg-sand-50 hover:text-sand-600"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-sand-100 px-6 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirmar',
  loading,
  onConfirm,
  onClose
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Voltar
          </Button>
          <Button variant="danger" loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-sand-600">{description}</p>
    </Modal>
  );
}

/* ---------------- Estados vazios / loading ---------------- */

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('h-6 w-6 animate-spin text-primary-500', className)} />;
}

export function FullPageSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-sand-100">
      <Spinner className="h-8 w-8" />
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-50 text-primary-600">
        <Icon className="h-6 w-6" />
      </div>
      <p className="mt-1 text-sm font-bold text-sand-900">{title}</p>
      {description && <p className="max-w-sm text-sm text-sand-500">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/* ---------------- Tabela (estilo do design: header primary-50) ---------------- */

export function Th({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <th
      className={cx(
        'bg-primary-50 px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-wider text-primary-700',
        className
      )}
    >
      {children}
    </th>
  );
}

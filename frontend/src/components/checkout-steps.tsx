import { Check } from 'lucide-react';
import { cx } from './ui';

const STEPS = ['Escolha o plano', 'Pagamento', 'Conta ativada'] as const;

/** Indicador do fluxo obrigatório: plano -> pagamento -> ativação. */
export function CheckoutSteps({ current }: { current: 1 | 2 | 3 }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-3 gap-y-2" aria-label="Etapas da assinatura">
      {STEPS.map((label, index) => {
        const step = index + 1;
        const done = step < current || current === 3;
        const active = step === current;
        return (
          <li key={label} className="flex items-center gap-3">
            <span
              aria-current={active ? 'step' : undefined}
              className={cx(
                'inline-flex items-center gap-2 text-[13px] font-semibold',
                done || active ? 'text-sand-900' : 'text-sand-400'
              )}
            >
              <span
                className={cx(
                  'flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold',
                  done
                    ? 'bg-leaf-600 text-white'
                    : active
                      ? 'bg-primary-500 text-white'
                      : 'bg-sand-200 text-sand-500'
                )}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : step}
              </span>
              {label}
            </span>
            {step < STEPS.length && <span className="hidden h-px w-8 bg-sand-300 sm:block" />}
          </li>
        );
      })}
    </ol>
  );
}

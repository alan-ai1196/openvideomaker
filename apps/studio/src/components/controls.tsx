import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'default' | 'primary' | 'ghost' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  icon?: ReactNode;
  label: string;
}

/** Icon button with accessible label + native tooltip. */
export function IconButton({ icon, label, ...rest }: ButtonProps) {
  return (
    <button className={'icon-button' + (rest.className ? ' ' + rest.className : '')} type="button" aria-label={label} title={label} {...rest}>
      {icon}
    </button>
  );
}

/** Standard button; label doubles as the accessible name. */
export function Button({ variant = 'default', icon, label, children, ...rest }: ButtonProps) {
  return (
    <button className={'button button-' + variant} type="button" aria-label={label} title={rest.title} {...rest}>
      {icon}
      <span>{children ?? label}</span>
    </button>
  );
}

/** Keyboard keycap hint. */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

/** Transient error toast; creators see what failed and what to do next. */
export function Toast({ title, message, code, onDismiss }: { title: string; message: string; code?: string; onDismiss: () => void }) {
  return (
    <div className="toast" role="alert">
      <div className="toast-title">{title}</div>
      <div className="toast-message">{message}</div>
      {code ? <div className="toast-code">{code}</div> : null}
      <IconButton icon={<XMark />} label="Dismiss" className="toast-dismiss" onClick={onDismiss} />
    </div>
  );
}

function XMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
    </svg>
  );
}

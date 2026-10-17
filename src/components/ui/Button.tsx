import { type ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'ghost' | 'danger';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  full?: boolean;
}

// Aurora .btn-* classes (index.css) are the app-wide button system — this
// component just wires variant → class so every consumer (form-sheet
// footers, page header actions) renders identically to the raw-class
// buttons used elsewhere, instead of the old mono/uppercase/flat look.
const VARIANT_CLASS: Record<Variant, string> = {
  primary: 'btn-primary',
  ghost:   'btn-ghost',
  danger:  'btn-danger',
};

// W7a (audit FE-UIS-16): `type` defaults to "button", so a Cancel inside a form no longer submits it.
// A form's submit button says type="submit" (every one already does).
export default function Button({ variant = 'primary', full = false, className = '', type = 'button', children, ...rest }: Props) {
  return (
    <button type={type} className={`${VARIANT_CLASS[variant]} ${full ? 'w-full' : ''} ${className}`} {...rest}>
      {children}
    </button>
  );
}

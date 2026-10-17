import { forwardRef, useState, type InputHTMLAttributes } from 'react';
import { Input } from './Input';

// Aurora 4.0 AU2 — a password field with a "Show" toggle inside it, so you can check what you typed.
// The id / aria props Field injects land on the <input> itself, so the label still names the field.
const PasswordInput = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>>(
  ({ className = '', ...props }, ref) => {
    const [shown, setShown] = useState(false);
    return (
      <div className="relative">
        <Input ref={ref} {...props} type={shown ? 'text' : 'password'} className={`pr-16 ${className}`} />
        <button type="button" onClick={() => setShown(s => !s)} aria-pressed={shown}
          aria-label={shown ? 'Hide password' : 'Show password'}
          className="absolute right-1 top-1/2 -translate-y-1/2 min-h-[40px] px-2.5 rounded-r2 text-[12.5px] font-medium hover:bg-bg3"
          style={{ color: 'var(--accent-text)' }}>
          {shown ? 'Hide' : 'Show'}
        </button>
      </div>
    );
  },
);
PasswordInput.displayName = 'PasswordInput';
export default PasswordInput;

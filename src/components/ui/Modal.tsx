// Aurora modal — now an ACCESSIBLE dialog (audit 6.1). Same role: a compact
// centered panel. The hand-rolled Escape listener + role="dialog" is replaced
// by Radix under AccessibleDialog (focus trap, restoration, inert background).
// Public props unchanged; Playwright can still target getByRole('dialog', { name }).
import { type ReactNode } from 'react';
import AccessibleDialog from './AccessibleDialog';

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export default function Modal({ open, title, onClose, children }: Props) {
  return (
    <AccessibleDialog open={open} onClose={onClose} title={title} variant="modal">
      {children}
    </AccessibleDialog>
  );
}

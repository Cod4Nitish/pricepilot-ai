"use client";
import { Dialog } from "./dialog";

/** Bottom sheet (mobile) / centered dialog (sm+). Focus trap, Escape and focus restore come from Dialog. */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title} variant="sheet">
      {children}
    </Dialog>
  );
}

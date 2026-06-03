import { type ReactNode, useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  width?: string;
}

export function Modal({ open, onClose, title, children, width = 'max-w-lg' }: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      {/*
       * max-h + flex-col + scrolling body is the safety net for "modal
       * content is taller than the viewport". Without it, sections that
       * grow with data (e.g. a bot with 130+ skills, a long scopes list)
       * push the action buttons below the screen — users see the dialog
       * but can't reach the "确认/蒸馏/关闭" buttons. The header stays
       * pinned so the close (×) is always reachable.
       */}
      <div
        className={`bg-claw-sidebar border border-claw-border rounded-2xl shadow-2xl w-full ${width} mx-4 animate-in fade-in flex flex-col max-h-[90vh]`}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-claw-border shrink-0">
          <h2 className="text-lg font-semibold text-claw-text">{title}</h2>
          <button
            onClick={onClose}
            className="text-claw-muted hover:text-claw-text transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>
        <div className="px-6 py-5 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

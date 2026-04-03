import { ReactNode } from "react";

interface Props {
  title?: string;
  children: ReactNode;
  className?: string;
}

export default function Card({ title, children, className = "" }: Props) {
  return (
    <div className={`bg-surface-100 border border-border rounded-xl p-4 ${className}`}>
      {title && <h2 className="text-sm font-semibold mb-3 text-gray-300">{title}</h2>}
      {children}
    </div>
  );
}

import { ReactNode } from "react";

interface Props {
  title?: string;
  children: ReactNode;
  className?: string;
}

export default function Card({ title, children, className = "" }: Props) {
  return (
    <div
      className={`rounded-card p-4 ${className}`}
      style={{ background: "linear-gradient(180deg, #161616 0%, #0d0d0d 100%)" }}
    >
      {title && <h2 className="text-sm font-semibold mb-3 text-white">{title}</h2>}
      {children}
    </div>
  );
}

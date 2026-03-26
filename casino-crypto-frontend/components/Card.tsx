import { ReactNode } from "react";

interface Props {
  title?: string;
  children: ReactNode;
  className?: string;
}

export default function Card({ title, children, className = "" }: Props) {
  return (
    <div className={`bg-gray-900 border border-gray-800 rounded-lg p-4 ${className}`}>
      {title && <h2 className="text-lg font-semibold mb-3 text-gray-200">{title}</h2>}
      {children}
    </div>
  );
}

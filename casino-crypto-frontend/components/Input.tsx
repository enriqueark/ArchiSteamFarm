import { InputHTMLAttributes } from "react";

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export default function Input({ label, className = "", ...props }: Props) {
  return (
    <div className="flex flex-col gap-1">
      {label && <label className="text-xs text-gray-500">{label}</label>}
      <input
        className={`bg-surface-200 border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 outline-none focus:border-brand/50 transition-colors ${className}`}
        {...props}
      />
    </div>
  );
}

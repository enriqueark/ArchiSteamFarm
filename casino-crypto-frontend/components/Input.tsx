import { InputHTMLAttributes } from "react";

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export default function Input({ label, className = "", ...props }: Props) {
  return (
    <div className="flex flex-col gap-1">
      {label && <label className="text-xs text-muted">{label}</label>}
      <input
        className={`bg-[#161616] border border-[#252525] rounded-btn px-3 py-2.5 text-sm text-white placeholder-[#555] outline-none focus:border-accent-red/50 transition-colors ${className}`}
        {...props}
      />
    </div>
  );
}

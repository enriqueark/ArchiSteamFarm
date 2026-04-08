import { ButtonHTMLAttributes } from "react";

const variants: Record<string, string> = {
  primary: "bg-gradient-to-r from-[#ac2e30] to-[#f75154] text-white shadow-[inset_0_1px_0_#f24f51,inset_0_-1px_0_#ff7476]",
  danger: "bg-red-700 hover:bg-red-800 text-white",
  success: "bg-green-600 hover:bg-green-700 text-white",
  secondary: "bg-panel text-white shadow-[inset_0_1px_0_#252525,inset_0_-1px_0_#242424]",
  red: "bg-[#ac2e30] hover:bg-[#c53030] text-white",
  black: "bg-[#161616] hover:bg-[#1a1a1a] text-white border border-[#252525]",
  green: "bg-emerald-700 hover:bg-emerald-800 text-white",
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
}

export default function Button({ variant = "primary", className = "", ...props }: Props) {
  return (
    <button
      className={`px-5 py-2.5 rounded-btn font-medium text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed ${variants[variant] || variants.primary} ${className}`}
      {...props}
    />
  );
}

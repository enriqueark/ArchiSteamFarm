import { ButtonHTMLAttributes } from "react";

const variants: Record<string, string> = {
  primary: "bg-brand hover:bg-brand-dark text-white",
  danger: "bg-red-700 hover:bg-red-800 text-white",
  success: "bg-green-600 hover:bg-green-700 text-white",
  secondary: "bg-surface-300 hover:bg-surface-400 text-gray-200",
  red: "bg-red-700 hover:bg-red-800 text-white",
  black: "bg-surface-200 hover:bg-surface-300 text-white border border-border",
  green: "bg-emerald-700 hover:bg-emerald-800 text-white",
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
}

export default function Button({ variant = "primary", className = "", ...props }: Props) {
  return (
    <button
      className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${variants[variant] || variants.primary} ${className}`}
      {...props}
    />
  );
}

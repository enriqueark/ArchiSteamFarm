import { ButtonHTMLAttributes } from "react";

const variants: Record<string, string> = {
  primary: "bg-indigo-600 hover:bg-indigo-700 text-white",
  danger: "bg-red-600 hover:bg-red-700 text-white",
  success: "bg-green-600 hover:bg-green-700 text-white",
  secondary: "bg-gray-700 hover:bg-gray-600 text-gray-100",
  red: "bg-red-700 hover:bg-red-800 text-white",
  black: "bg-gray-900 hover:bg-gray-800 text-white border border-gray-600",
  green: "bg-emerald-700 hover:bg-emerald-800 text-white",
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
}

export default function Button({ variant = "primary", className = "", ...props }: Props) {
  return (
    <button
      className={`px-4 py-2 rounded font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${variants[variant] || variants.primary} ${className}`}
      {...props}
    />
  );
}

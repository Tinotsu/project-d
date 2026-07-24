import { forwardRef, type ButtonHTMLAttributes } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "outline" | "ghost" | "destructive";
  size?: "default" | "sm" | "lg";
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className = "", size = "default", variant = "default", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={`button button-${variant} button-${size} ${className}`.trim()}
      {...props}
    />
  );
});

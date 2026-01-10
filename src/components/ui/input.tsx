import { InputHTMLAttributes, forwardRef } from "react";
import cn from "classnames";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "px-3 py-2 border rounded w-full focus:outline-none focus:ring focus:border-primary",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";
export default Input;

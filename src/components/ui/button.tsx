import { ButtonHTMLAttributes, cloneElement, isValidElement, ReactElement } from "react";
import cn from "classnames";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'ghost' | 'link';
  size?: 'default' | 'sm' | 'lg';
  /** Render button styles on the child element instead of a <button> tag. */
  asChild?: boolean;
}

export function Button({ className, variant = 'default', size = 'default', asChild, children, ...props }: ButtonProps) {
  const variants = {
    default: "bg-primary text-white hover:bg-primary/90",
    outline: "border border-gray-300 bg-white hover:bg-gray-50 text-gray-900",
    ghost: "hover:bg-gray-100 text-gray-900",
    link: "text-primary underline-offset-4 hover:underline"
  };

  const sizes = {
    default: "px-4 py-2",
    sm: "px-3 py-1 text-sm",
    lg: "px-6 py-3 text-lg"
  };

  const buttonClass = cn(
    "rounded font-medium transition",
    variants[variant],
    sizes[size],
    className
  );

  if (asChild && isValidElement(children)) {
    return cloneElement(children as ReactElement<{ className?: string }>, {
      className: cn(buttonClass, (children as ReactElement<{ className?: string }>).props.className),
    });
  }

  return (
    <button className={buttonClass} {...props}>
      {children}
    </button>
  );
}
export default Button;

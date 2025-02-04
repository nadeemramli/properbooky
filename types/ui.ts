import type { VariantProps } from "class-variance-authority";
import type { buttonVariants } from "@/components/ui/button";
import type {
  HTMLAttributes,
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  TextareaHTMLAttributes,
  FormHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
} from "react";

// Re-export common types
export type ButtonVariants = VariantProps<typeof buttonVariants>;

// Common HTML element props
export type DivProps = HTMLAttributes<HTMLDivElement>;
export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;
export type InputProps = InputHTMLAttributes<HTMLInputElement>;
export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;
export type FormProps = FormHTMLAttributes<HTMLFormElement>;
export type LabelProps = LabelHTMLAttributes<HTMLLabelElement>;

// Common utility types
export type WithClassName = {
  className?: string;
};

export type WithChildren = {
  children?: ReactNode;
};

export type WithRequired<T, K extends keyof T> = T & {
  [P in K]-?: T[P];
};

export type WithOptional<T, K extends keyof T> = Omit<T, K> & {
  [P in K]?: T[P];
};

// Re-export common types for external use
export type { 
  HTMLAttributes,
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  TextareaHTMLAttributes,
  FormHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
}; 
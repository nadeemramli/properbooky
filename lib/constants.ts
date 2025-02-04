export const BOOK_STATUS_VARIANTS = {
  completed: "default",
  reading: "secondary",
  unread: "outline",
} as const;

export type BookStatusVariant = typeof BOOK_STATUS_VARIANTS[keyof typeof BOOK_STATUS_VARIANTS]; 
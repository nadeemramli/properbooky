import type { Tag } from "@/types/book";
import { X } from "lucide-react";

interface TagBadgeProps {
  tag: Tag;
  onRemove?: () => void;
  className?: string;
}

export function TagBadge({ tag, onRemove, className = "" }: TagBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${className}`}
      style={{ backgroundColor: `${tag.color}20`, color: tag.color }}
    >
      {tag.name}
      {onRemove && (
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemove();
          }}
          className="hover:bg-black/10 rounded-full p-0.5"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

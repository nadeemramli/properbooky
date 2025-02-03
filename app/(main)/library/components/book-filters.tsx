"use client";

import { cn } from "@/lib/utils";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

interface BookFiltersProps extends React.HTMLAttributes<HTMLDivElement> {}

const formats = [
  { id: "epub", label: "EPUB" },
  { id: "pdf", label: "PDF" },
];

const status = [
  { id: "unread", label: "Unread" },
  { id: "reading", label: "Reading" },
  { id: "completed", label: "Completed" },
];

const tags = [
  { id: "fiction", label: "Fiction", count: 12 },
  { id: "non-fiction", label: "Non-Fiction", count: 8 },
  { id: "programming", label: "Programming", count: 5 },
  { id: "science", label: "Science", count: 3 },
  { id: "history", label: "History", count: 4 },
];

export function BookFilters({ className, ...props }: BookFiltersProps) {
  return (
    <div className={cn("space-y-4", className)} {...props}>
      <Accordion
        type="multiple"
        defaultValue={["format", "status", "tags"]}
        className="space-y-4"
      >
        <AccordionItem value="format">
          <AccordionTrigger>Format</AccordionTrigger>
          <AccordionContent>
            <div className="space-y-4 pt-2">
              {formats.map((format) => (
                <div key={format.id} className="flex items-center space-x-2">
                  <Checkbox id={format.id} />
                  <Label htmlFor={format.id}>{format.label}</Label>
                </div>
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="status">
          <AccordionTrigger>Status</AccordionTrigger>
          <AccordionContent>
            <div className="space-y-4 pt-2">
              {status.map((s) => (
                <div key={s.id} className="flex items-center space-x-2">
                  <Checkbox id={s.id} />
                  <Label htmlFor={s.id}>{s.label}</Label>
                </div>
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="tags">
          <AccordionTrigger>Tags</AccordionTrigger>
          <AccordionContent>
            <div className="space-y-4 pt-2">
              {tags.map((tag) => (
                <div key={tag.id} className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Checkbox id={tag.id} />
                    <Label htmlFor={tag.id}>{tag.label}</Label>
                  </div>
                  <Badge variant="secondary">{tag.count}</Badge>
                </div>
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}

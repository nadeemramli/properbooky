"use client";

import { useState } from "react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { cn } from "@/lib/utils";
import { TableOfContents } from "../../components/reader/TableOfContents";
import { BookProfile } from "../../components/reader/BookProfile";
import { ReaderProvider } from "@/lib/contexts/reader-context";

interface ReaderLayoutProps {
  children: React.ReactNode;
}

export default function ReaderLayout({ children }: ReaderLayoutProps) {
  const [isCollapsed, setIsCollapsed] = useState({
    left: false,
    right: false,
  });

  return (
    <ReaderProvider>
      <div className="h-screen">
        <ResizablePanelGroup direction="horizontal">
          <ResizablePanel
            defaultSize={20}
            collapsible
            minSize={15}
            maxSize={30}
            onCollapse={() => setIsCollapsed({ ...isCollapsed, left: true })}
            onExpand={() => setIsCollapsed({ ...isCollapsed, left: false })}
            className={cn(
              isCollapsed.left &&
                "min-w-[50px] transition-all duration-300 ease-in-out"
            )}
          >
            <TableOfContents collapsed={isCollapsed.left} />
          </ResizablePanel>

          <ResizableHandle />

          <ResizablePanel defaultSize={60}>
            <main className="h-full">{children}</main>
          </ResizablePanel>

          <ResizableHandle />

          <ResizablePanel
            defaultSize={20}
            collapsible
            minSize={15}
            maxSize={30}
            onCollapse={() => setIsCollapsed({ ...isCollapsed, right: true })}
            onExpand={() => setIsCollapsed({ ...isCollapsed, right: false })}
            className={cn(
              isCollapsed.right &&
                "min-w-[50px] transition-all duration-300 ease-in-out"
            )}
          >
            <BookProfile collapsed={isCollapsed.right} />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </ReaderProvider>
  );
}

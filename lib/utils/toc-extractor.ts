import { pdfjs } from "react-pdf";
import * as epubjs from "epubjs";
import type { TOCItem } from "@/types/book";

// Helper function to generate unique IDs
function generateId(): string {
  return crypto.randomUUID();
}

// Convert PDF outline to our TOC format
function convertPDFOutlineToTOC(outline: any[]): TOCItem[] {
  if (!Array.isArray(outline)) return [];
  
  return outline.map((item) => {
    const tocItem: TOCItem = {
      id: generateId(),
      title: item.title || "Untitled",
      page: item.dest?.[0]?.num || 1,
      level: item.level || 0,
    };

    if (item.items && item.items.length > 0) {
      tocItem.children = convertPDFOutlineToTOC(item.items);
    }

    return tocItem;
  });
}

// Convert EPUB nav items to our TOC format
function convertEPUBNavToTOC(nav: any[]): TOCItem[] {
  if (!Array.isArray(nav)) return [];

  return nav.map((item) => {
    const tocItem: TOCItem = {
      id: generateId(),
      title: item.label || "Untitled",
      page: item.page || 1,
      level: item.level || 0,
    };

    if (item.subitems && item.subitems.length > 0) {
      tocItem.children = convertEPUBNavToTOC(item.subitems);
    }

    return tocItem;
  });
}

export async function extractPDFTOC(fileUrl: string): Promise<TOCItem[]> {
  try {
    const response = await fetch(fileUrl);
    if (!response.ok) {
      throw new Error("Failed to fetch PDF file");
    }

    const arrayBuffer = await response.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
    const outline = await pdf.getOutline();

    if (!outline || outline.length === 0) {
      // Return a basic TOC with just page numbers if no outline exists
      const pageCount = pdf.numPages;
      return Array.from({ length: pageCount }, (_, i) => ({
        id: generateId(),
        title: `Page ${i + 1}`,
        page: i + 1,
        level: 0,
      }));
    }

    return convertPDFOutlineToTOC(outline);
  } catch (error) {
    console.error("Error extracting PDF TOC:", error);
    return [];
  }
}

export async function extractEPUBTOC(fileUrl: string): Promise<TOCItem[]> {
  try {
    const book = epubjs.default();
    await book.open(fileUrl);
    
    // Get navigation
    const navigation = await book.loaded.navigation;
    if (!navigation) {
      throw new Error("Failed to load EPUB navigation");
    }

    const toc = navigation.toc || [];
    const result = convertEPUBNavToTOC(toc);
    
    // Clean up
    await book.destroy();
    
    return result;
  } catch (error) {
    console.error("Error extracting EPUB TOC:", error);
    return [];
  }
}

export async function extractTOC(fileUrl: string, format: "pdf" | "epub"): Promise<TOCItem[]> {
  try {
    if (!fileUrl) {
      throw new Error("No file URL provided");
    }

    if (format === "pdf") {
      return await extractPDFTOC(fileUrl);
    } else if (format === "epub") {
      return await extractEPUBTOC(fileUrl);
    } else {
      throw new Error(`Unsupported format: ${format}`);
    }
  } catch (error) {
    console.error("Error extracting TOC:", error);
    return [];
  }
} 
import Papa from "papaparse";
import type { WishlistCSVRow } from "../types";

const TEMPLATE_HEADERS = [
  "title",
  "author",
  "isbn",
  "reason",
  "source",
  "priority",
  "notes",
  "goodreads_url",
  "amazon_url",
];

const SAMPLE_DATA: WishlistCSVRow[] = [
  {
    title: "The Great Gatsby",
    author: "F. Scott Fitzgerald",
    isbn: "9780743273565",
    reason: "Classic literature that I want to read",
    source: "Book club recommendation",
    priority: 8,
    notes: "Important for understanding American literature",
    goodreads_url: "https://www.goodreads.com/book/show/4671.The_Great_Gatsby",
    amazon_url: "https://www.amazon.com/Great-Gatsby-F-Scott-Fitzgerald/dp/0743273567",
  },
];

export function generateCSVTemplate(includeSampleData = false): string {
  const data = includeSampleData ? SAMPLE_DATA : [];
  return Papa.unparse(data, {
    header: true,
    columns: TEMPLATE_HEADERS,
  });
}

export function downloadCSVTemplate(includeSampleData = false) {
  const csv = generateCSVTemplate(includeSampleData);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  
  link.setAttribute("href", url);
  link.setAttribute("download", "wishlist-template.csv");
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
} 
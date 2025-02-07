import type Book from "epubjs";
import type { PackagingMetadataObject } from "epubjs/types/packaging";

export interface EPUBMetadata extends Partial<PackagingMetadataObject> {
  layout?: string;
  orientation?: string;
  flow?: string;
  viewport?: string;
}

export type { Book as EPUBBook, PackagingMetadataObject }; 
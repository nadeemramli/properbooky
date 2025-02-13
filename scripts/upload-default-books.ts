import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

// Load environment variables
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing required environment variables");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function uploadDefaultBooks() {
  try {
    // Create default-books bucket if it doesn't exist
    const { data: buckets } = await supabase.storage.listBuckets();
    if (!buckets?.find(b => b.name === "default-books")) {
      await supabase.storage.createBucket("default-books", {
        public: true,
        fileSizeLimit: 100000000, // 100MB
      });
    }

    // Upload sample PDF
    const samplePdfPath = path.join(process.cwd(), "public", "default-books", "sample.pdf");
    const sampleCoverPath = path.join(process.cwd(), "public", "default-books", "sample-cover.jpg");

    if (fs.existsSync(samplePdfPath)) {
      const pdfFile = fs.readFileSync(samplePdfPath);
      const { error: pdfError } = await supabase.storage
        .from("default-books")
        .upload("sample.pdf", pdfFile, {
          contentType: "application/pdf",
          upsert: true,
        });

      if (pdfError) {
        console.error("Error uploading PDF:", pdfError);
      } else {
        console.log("Successfully uploaded sample.pdf");
      }
    }

    if (fs.existsSync(sampleCoverPath)) {
      const coverFile = fs.readFileSync(sampleCoverPath);
      const { error: coverError } = await supabase.storage
        .from("default-books")
        .upload("sample-cover.jpg", coverFile, {
          contentType: "image/jpeg",
          upsert: true,
        });

      if (coverError) {
        console.error("Error uploading cover:", coverError);
      } else {
        console.log("Successfully uploaded sample-cover.jpg");
      }
    }

    console.log("Default books upload completed");
  } catch (error) {
    console.error("Error uploading default books:", error);
  }
}

uploadDefaultBooks(); 
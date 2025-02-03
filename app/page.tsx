import SupabaseConnectionTest from "@/components/SupabaseConnectionTest";

export default function Home() {
  return (
    <div
      style={{
        maxWidth: 1280,
        margin: "0 auto",
        padding: "2rem",
      }}
    >
      <h1 className="text-2xl font-bold mb-8">Properbooky</h1>
      <SupabaseConnectionTest />
    </div>
  );
}

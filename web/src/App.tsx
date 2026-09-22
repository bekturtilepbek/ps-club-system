import { useQuery } from "@tanstack/react-query";

async function fetchHealth(): Promise<{ status: string }> {
  const res = await fetch("/api/health");
  if (!res.ok) {
    throw new Error(`API responded with ${res.status}`);
  }
  return res.json();
}

export default function App() {
  const { data, error, isLoading } = useQuery({
    queryKey: ["health"],
    queryFn: fetchHealth,
  });

  return (
    <main className="p-8 font-sans">
      <h1 className="text-2xl font-bold">PS Club</h1>
      {isLoading && <p>Проверка соединения с API...</p>}
      {error && <p className="text-red-600">Нет связи с API: {error.message}</p>}
      {data && <p className="text-green-600">API отвечает: {data.status}</p>}
    </main>
  );
}

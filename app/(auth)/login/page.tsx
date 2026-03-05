"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      const user = data.user;
      if (user) {
        // Check junction table first — covers beta users mapped via admin panel
        const { data: ucRows } = await supabase
          .from("user_clients")
          .select("client_id, clients(id, brand_name, status)")
          .or(`user_id.eq.${user.id},email.eq.${user.email ?? ""}`);

        const junctionClients = (ucRows ?? [])
          .map((r) => r.clients as unknown as { id: string; status: string } | null)
          .filter((c): c is { id: string; status: string } => c !== null);

        // Also check direct ownership for admin/owner accounts
        const { data: ownedClients } = await supabase
          .from("clients")
          .select("id, status")
          .eq("user_id", user.id);

        // Merge + deduplicate, prefer any active client
        const allClients = [...junctionClients, ...(ownedClients ?? [])];
        const unique = Array.from(new Map(allClients.map((c) => [c.id, c])).values());
        const activeClient = unique.find((c) => c.status === "active");

        if (activeClient) {
          router.push(`/dashboard/overview?client=${activeClient.id}`);
        } else {
          router.push("/discover");
        }
      } else {
        router.push("/discover");
      }
      router.refresh();
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="font-exo2 font-black text-3xl tracking-tight">Shadovi</h1>
          <p className="text-sm text-muted-foreground mt-1">AEO Intelligence Platform</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Sign in</CardTitle>
            <CardDescription>Enter your email and password to continue.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="email">
                  Email
                </label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="password">
                  Password
                </label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </div>

              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Signing in…" : "Sign in"}
              </Button>
            </form>

            <p className="text-center text-sm text-muted-foreground mt-4">
              No account?{" "}
              <a href="/signup" className="underline underline-offset-4 hover:text-foreground">
                Create one
              </a>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

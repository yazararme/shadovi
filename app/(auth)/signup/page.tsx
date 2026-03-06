"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function SignupPage() {
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
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      // Auto sign-in after signup
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        // Email confirmation might be required
        setError("Check your email to confirm your account, then sign in.");
        setLoading(false);
      } else {
        router.push("/discover");
        router.refresh();
      }
    }
  }

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* ── Left panel: brand showcase ── */}
      <div className="dark-grid relative flex flex-col justify-center items-start px-10 lg:px-16 py-12 lg:py-0 lg:w-[55%] overflow-hidden" style={{ background: "#0D0437" }}>
        <h1 className="font-exo2 font-black text-4xl lg:text-5xl text-white tracking-tight">Shadovi</h1>
        <p className="text-white/60 text-base lg:text-lg mt-2">Start tracking your brand&apos;s AI visibility</p>

        {/* Signal lines */}
        <div className="mt-12 space-y-3 max-w-[200px]">
          <div className="flex items-center gap-3" style={{ opacity: 0, animation: "fadeInUp 0.6s ease forwards", animationDelay: "0.3s" }}>
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: "#FF4B6E" }} />
            <div className="h-1.5 rounded-full bg-white/10" style={{ width: "40%" }} />
          </div>
          <div className="flex items-center gap-3" style={{ opacity: 0, animation: "fadeInUp 0.6s ease forwards", animationDelay: "0.5s" }}>
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: "#7B5EA7" }} />
            <div className="h-1.5 rounded-full bg-white/10" style={{ width: "65%" }} />
          </div>
          <div className="flex items-center gap-3" style={{ opacity: 0, animation: "fadeInUp 0.6s ease forwards", animationDelay: "0.7s" }}>
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: "#00B4D8" }} />
            <div className="h-1.5 rounded-full bg-white/10" style={{ width: "50%" }} />
          </div>
        </div>

        {/* Animated gradient orb */}
        <div
          className="absolute pointer-events-none"
          style={{
            width: 300,
            height: 300,
            bottom: "10%",
            right: "5%",
            background: "radial-gradient(circle, #FF4B6E, #7B5EA7, #00B4D8)",
            filter: "blur(80px)",
            opacity: 0.3,
            animation: "float-orb 15s ease-in-out infinite alternate",
          }}
        />
      </div>

      {/* ── Right panel: form ── */}
      <div className="flex-1 flex items-center justify-center bg-white px-6 py-12">
        <div className="w-full max-w-[380px] px-2">
          {/* Gradient accent bar */}
          <div className="h-[3px] w-16 rounded-full mb-8" style={{ background: "linear-gradient(to right, #FF4B6E, #7B5EA7, #00B4D8)" }} />

          <h2 className="text-2xl font-bold text-[#1A1A2E]">Create an account</h2>
          <p className="text-sm text-[#6B7280] mt-1 mb-6">Start tracking your brand&apos;s AI visibility.</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="email">
                Work email
              </label>
              <Input
                id="email"
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="password">
                Password
              </label>
              <Input
                id="password"
                type="password"
                placeholder="At least 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                className="h-11"
              />
            </div>

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            <Button
              type="submit"
              className="w-full text-white border-0 h-11 font-semibold"
              style={{ background: "linear-gradient(135deg, #FF4B6E, #00B4D8)" }}
              disabled={loading}
            >
              {loading ? "Creating account\u2026" : "Create account"}
            </Button>
          </form>

          <p className="text-center text-sm text-[#6B7280] mt-6">
            Already have an account?{" "}
            <a href="/login" className="text-[#0D0437] font-medium hover:underline">
              Sign in
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}

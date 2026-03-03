"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Copy, ArrowLeft, Download, Trash2 } from "lucide-react";
import type { Client, LLMModel } from "@/types";


// ─── Types ────────────────────────────────────────────────────────────────────

interface AdminClient extends Client {
  runCount:     number;
  mappingCount: number;
}

interface AdminMapping {
  id:         string;
  user_id:    string | null;
  email:      string | null;
  client_id:  string;
  role:       "admin" | "viewer";
  created_at: string;
  clients:    { brand_name: string | null } | null;
}

interface RecentRun {
  id:                string;
  ran_at:            string;
  model:             LLMModel;
  query_intent:      string | null;
  mention_sentiment: string | null;
  client_id:         string;
  clients:           { brand_name: string | null } | null;
}

// ─── Badge helpers ────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, string> = {
  active:      "bg-[rgba(26,143,92,0.08)] text-[#1A8F5C] border-[rgba(26,143,92,0.2)]",
  onboarding:  "bg-[rgba(245,158,11,0.1)] text-[#F59E0B] border-[rgba(245,158,11,0.2)]",
  paused:      "bg-[#F4F6F9] text-[#6B7280] border-[#E2E8F0]",
};

const ROLE_BADGE: Record<string, string> = {
  admin:  "bg-[rgba(123,94,167,0.08)] text-[#7B5EA7] border-[rgba(123,94,167,0.2)]",
  viewer: "bg-[#F4F6F9] text-[#6B7280] border-[#E2E8F0]",
};

const SENTIMENT_BADGE: Record<string, string> = {
  positive:      "bg-[rgba(26,143,92,0.08)] text-[#1A8F5C] border-[rgba(26,143,92,0.2)]",
  neutral:       "bg-[#F4F6F9] text-[#6B7280] border-[#E2E8F0]",
  negative:      "bg-[rgba(255,75,110,0.08)] text-[#FF4B6E] border-[rgba(255,75,110,0.2)]",
  not_mentioned: "bg-[#F4F6F9] text-[#9CA3AF] border-[#E2E8F0]",
};

const MODEL_LABELS: Record<string, string> = {
  "gpt-4o":            "GPT-4o",
  "claude-sonnet-4-6": "Claude",
  "perplexity":        "Perplexity",
  "gemini":            "Gemini",
  "deepseek":          "DeepSeek",
};

// ─── Utilities ────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

async function copyToClipboard(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  } catch {
    toast.error("Clipboard access denied");
  }
}

function Badge({ text, className }: { text: string; className: string }) {
  return (
    <span className={`inline-flex items-center text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${className}`}>
      {text}
    </span>
  );
}

// ─── CSV export ───────────────────────────────────────────────────────────────

function exportClientsCsv(clients: AdminClient[]) {
  const headers = ["Brand Name", "Client ID", "URL", "Status", "Models", "Frequency", "Created", "Total Runs", "Mapped Users"];
  const rows = clients.map((c) => [
    c.brand_name ?? "",
    c.id,
    c.url ?? "",
    c.status,
    (c.selected_models ?? []).join("|"),
    c.tracking_frequency,
    formatDate(c.created_at),
    c.runCount,
    c.mappingCount,
  ]);
  const csv = [headers, ...rows]
    .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `shadovi-clients-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const router = useRouter();

  const [loading,    setLoading]    = useState(true);
  const [clients,    setClients]    = useState<AdminClient[]>([]);
  const [mappings,   setMappings]   = useState<AdminMapping[]>([]);
  const [recentRuns, setRecentRuns] = useState<RecentRun[]>([]);

  // Add-mapping form
  const [newEmail,    setNewEmail]    = useState("");
  const [newClientId, setNewClientId] = useState("");
  const [newRole,     setNewRole]     = useState<"viewer" | "admin">("viewer");
  const [submitting,  setSubmitting]  = useState(false);

  // Inline remove confirmation: stores the mapping id pending confirmation
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  useEffect(() => {
    // Auth is enforced server-side by /api/admin/data (returns 403 if not admin).
    // loadData() redirects to /dashboard/overview on any non-OK response, so no
    // client-side email check is needed here.
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/data");
      if (!res.ok) { router.replace("/dashboard/overview"); return; }
      const json = await res.json();
      setClients(json.clients ?? []);
      setMappings(json.mappings ?? []);
      setRecentRuns(json.recentRuns ?? []);
    } finally {
      setLoading(false);
    }
  }

  async function handleAddMapping(e: React.FormEvent) {
    e.preventDefault();
    if (!newEmail.trim() || !newClientId) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/add-mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: newEmail.trim(), client_id: newClientId, role: newRole }),
      });
      if (res.status === 409) {
        toast.error("This email is already mapped to this client.");
        return;
      }
      if (!res.ok) {
        toast.error("Failed to add mapping.");
        return;
      }
      const brand = clients.find((c) => c.id === newClientId)?.brand_name ?? newClientId;
      toast.success(`Mapping added. ${newEmail.trim()} will see ${brand} on next login.`);
      setNewEmail("");
      setNewClientId("");
      setNewRole("viewer");
      await loadData();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemoveMapping(id: string) {
    const res = await fetch("/api/admin/remove-mapping", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setConfirmRemoveId(null);
    if (!res.ok) {
      toast.error("Failed to remove mapping.");
      return;
    }
    toast.success("Mapping removed.");
    setMappings((prev) => prev.filter((m) => m.id !== id));
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-[#F9FAFB] flex items-center justify-center">
        <span className="text-[13px] text-[#9CA3AF]">Loading admin panel…</span>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#F9FAFB]">

      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <header className="bg-[#0D0437] px-6 py-3 flex items-center justify-between print:hidden">
        <div className="flex items-center gap-4">
          <span className="font-exo2 font-black text-[20px] leading-none tracking-tight text-white">
            Shadovi
          </span>
          <span className="text-white/30 text-sm select-none">|</span>
          <span className="text-[12px] font-semibold text-white/60 uppercase tracking-widest">
            Admin Panel
          </span>
        </div>
        <Link
          href="/dashboard/overview"
          className="flex items-center gap-1.5 text-[12px] text-white/60 hover:text-white transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Dashboard
        </Link>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-10">

        {/* ══════════════════════════════════════════════════════════════════
            SECTION 1 — Client Overview
        ═══════════════════════════════════════════════════════════════════ */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[16px] font-bold text-[#0D0437]">
              Clients <span className="text-[#9CA3AF] font-normal">({clients.length} total)</span>
            </h2>
            <button
              onClick={() => exportClientsCsv(clients)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-bold border border-[#E2E8F0] text-[#6B7280] bg-white hover:bg-[#F4F6F9] hover:text-[#0D0437] transition-colors"
            >
              <Download className="h-3 w-3" />
              Export CSV
            </button>
          </div>

          <div className="bg-white border border-[#E2E8F0] rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-[#E2E8F0] bg-[#F9FAFB]">
                    {["Brand Name", "Client ID", "URL", "Status", "Models", "Freq", "Created", "Runs", "Users", ""].map((h) => (
                      <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF] whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F1F5F9]">
                  {clients.map((c) => (
                    <tr key={c.id} className="hover:bg-[#FAFBFC] transition-colors">
                      <td className="px-3 py-2 font-medium text-[#0D0437] whitespace-nowrap">
                        {c.brand_name ?? "—"}
                      </td>
                      <td className="px-3 py-2">
                        <button
                          onClick={() => copyToClipboard(c.id, "Client ID")}
                          className="flex items-center gap-1 font-mono text-[10px] text-[#6B7280] hover:text-[#0D0437] transition-colors group"
                          title={c.id}
                        >
                          <span>{c.id.slice(0, 8)}…</span>
                          <Copy className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100" />
                        </button>
                      </td>
                      <td className="px-3 py-2 max-w-[140px]">
                        <a
                          href={c.url ? (c.url.startsWith("http") ? c.url : `https://${c.url}`) : "#"}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#6B7280] hover:text-[#0D0437] truncate block transition-colors"
                          title={c.url ?? ""}
                        >
                          {c.url ?? "—"}
                        </a>
                      </td>
                      <td className="px-3 py-2">
                        <Badge
                          text={c.status}
                          className={STATUS_BADGE[c.status] ?? STATUS_BADGE.paused}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {(c.selected_models ?? []).map((m) => (
                            <span
                              key={m}
                              className="text-[9px] px-1.5 py-0.5 rounded bg-[rgba(13,4,55,0.06)] text-[#0D0437] border border-[rgba(13,4,55,0.1)]"
                            >
                              {MODEL_LABELS[m] ?? m}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-[#6B7280] capitalize whitespace-nowrap">
                        {c.tracking_frequency}
                      </td>
                      <td className="px-3 py-2 text-[#6B7280] whitespace-nowrap">
                        {formatDate(c.created_at)}
                      </td>
                      <td className="px-3 py-2 font-medium text-[#0D0437] text-center">
                        {c.runCount.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-[#6B7280] text-center">
                        {c.mappingCount}
                      </td>
                      <td className="px-3 py-2">
                        <Link
                          href={`/dashboard/overview?client=${c.id}`}
                          className="text-[11px] font-bold text-[#0D0437] hover:text-[#7B5EA7] transition-colors whitespace-nowrap"
                        >
                          View →
                        </Link>
                      </td>
                    </tr>
                  ))}
                  {clients.length === 0 && (
                    <tr>
                      <td colSpan={10} className="px-3 py-8 text-center text-[#9CA3AF] text-[12px]">
                        No clients found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════════════
            SECTION 2 — User-Client Mappings
        ═══════════════════════════════════════════════════════════════════ */}
        <section>
          <h2 className="text-[16px] font-bold text-[#0D0437] mb-3">
            User Access Mappings{" "}
            <span className="text-[#9CA3AF] font-normal">({mappings.length} total)</span>
          </h2>

          {/* Add mapping form */}
          <div className="bg-white border border-[#E2E8F0] rounded-lg p-4 mb-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-[#9CA3AF] mb-3">
              Add New Mapping
            </p>
            <form onSubmit={handleAddMapping} className="flex items-end gap-3 flex-wrap">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-[#6B7280] uppercase tracking-wider">
                  Email
                </label>
                <input
                  type="email"
                  placeholder="user@example.com"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  required
                  className="w-56 px-3 py-1.5 text-[12px] border border-[#E2E8F0] rounded-md focus:outline-none focus:border-[#0D0437] text-[#0D0437] placeholder:text-[#C4B5D8]"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-[#6B7280] uppercase tracking-wider">
                  Client
                </label>
                <select
                  value={newClientId}
                  onChange={(e) => setNewClientId(e.target.value)}
                  required
                  className="w-48 px-3 py-1.5 text-[12px] border border-[#E2E8F0] rounded-md focus:outline-none focus:border-[#0D0437] text-[#0D0437] bg-white"
                >
                  <option value="">Select client…</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.brand_name ?? c.url}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-[#6B7280] uppercase tracking-wider">
                  Role
                </label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as "viewer" | "admin")}
                  className="w-28 px-3 py-1.5 text-[12px] border border-[#E2E8F0] rounded-md focus:outline-none focus:border-[#0D0437] text-[#0D0437] bg-white"
                >
                  <option value="viewer">Viewer</option>
                  <option value="admin">Admin</option>
                </select>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-1.5 rounded-md text-[12px] font-bold bg-[#0D0437] text-white hover:bg-[#1a1150] disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                {submitting ? "Adding…" : "Add Mapping"}
              </button>
            </form>
          </div>

          {/* Mappings table */}
          <div className="bg-white border border-[#E2E8F0] rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-[#E2E8F0] bg-[#F9FAFB]">
                    {["Email", "User ID", "Client", "Client ID", "Role", "Created", ""].map((h) => (
                      <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF] whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F1F5F9]">
                  {mappings.map((m) => (
                    <tr key={m.id} className="hover:bg-[#FAFBFC] transition-colors">
                      <td className="px-3 py-2 text-[#0D0437] font-medium">
                        {m.email ?? "—"}
                      </td>
                      <td className="px-3 py-2 font-mono text-[10px] text-[#6B7280]">
                        {m.user_id ? (
                          <button
                            onClick={() => copyToClipboard(m.user_id!, "User ID")}
                            className="flex items-center gap-1 hover:text-[#0D0437] transition-colors group"
                            title={m.user_id}
                          >
                            <span>{m.user_id.slice(0, 8)}…</span>
                            <Copy className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100" />
                          </button>
                        ) : (
                          <span className="text-[#F59E0B] font-sans text-[10px] font-medium">
                            Pending signup
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-[#0D0437] whitespace-nowrap">
                        {(m.clients as { brand_name: string | null } | null)?.brand_name ?? "—"}
                      </td>
                      <td className="px-3 py-2">
                        <button
                          onClick={() => copyToClipboard(m.client_id, "Client ID")}
                          className="flex items-center gap-1 font-mono text-[10px] text-[#6B7280] hover:text-[#0D0437] transition-colors group"
                          title={m.client_id}
                        >
                          <span>{m.client_id.slice(0, 8)}…</span>
                          <Copy className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100" />
                        </button>
                      </td>
                      <td className="px-3 py-2">
                        <Badge
                          text={m.role}
                          className={ROLE_BADGE[m.role] ?? ROLE_BADGE.viewer}
                        />
                      </td>
                      <td className="px-3 py-2 text-[#6B7280] whitespace-nowrap">
                        {formatDate(m.created_at)}
                      </td>
                      <td className="px-3 py-2">
                        {confirmRemoveId === m.id ? (
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => handleRemoveMapping(m.id)}
                              className="text-[10px] font-bold text-[#FF4B6E] hover:underline whitespace-nowrap"
                            >
                              Confirm
                            </button>
                            <button
                              onClick={() => setConfirmRemoveId(null)}
                              className="text-[10px] text-[#9CA3AF] hover:text-[#6B7280]"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmRemoveId(m.id)}
                            className="text-[#9CA3AF] hover:text-[#FF4B6E] transition-colors"
                            title="Remove mapping"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {mappings.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-3 py-8 text-center text-[#9CA3AF] text-[12px]">
                        No mappings yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════════════
            SECTION 3 — Recent Activity Feed
        ═══════════════════════════════════════════════════════════════════ */}
        <section className="pb-12">
          <h2 className="text-[16px] font-bold text-[#0D0437] mb-3">
            Recent Runs{" "}
            <span className="text-[#9CA3AF] font-normal">(last 50)</span>
          </h2>

          <div className="bg-white border border-[#E2E8F0] rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-[#E2E8F0] bg-[#F9FAFB]">
                    {["Ran At", "Brand", "Model", "Intent", "Sentiment"].map((h) => (
                      <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF] whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F1F5F9]">
                  {recentRuns.map((r) => (
                    <tr key={r.id} className="hover:bg-[#FAFBFC] transition-colors">
                      <td className="px-3 py-2 text-[#6B7280] whitespace-nowrap font-mono text-[11px]">
                        {formatDateTime(r.ran_at)}
                      </td>
                      <td className="px-3 py-2 font-medium text-[#0D0437] whitespace-nowrap">
                        {(r.clients as { brand_name: string | null } | null)?.brand_name ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-[#6B7280] whitespace-nowrap">
                        {MODEL_LABELS[r.model] ?? r.model}
                      </td>
                      <td className="px-3 py-2 text-[#6B7280] capitalize whitespace-nowrap">
                        {r.query_intent?.replace(/_/g, " ") ?? "—"}
                      </td>
                      <td className="px-3 py-2">
                        {r.mention_sentiment ? (
                          <Badge
                            text={r.mention_sentiment.replace(/_/g, " ")}
                            className={SENTIMENT_BADGE[r.mention_sentiment] ?? SENTIMENT_BADGE.not_mentioned}
                          />
                        ) : (
                          <span className="text-[#9CA3AF]">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {recentRuns.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-8 text-center text-[#9CA3AF] text-[12px]">
                        No runs recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

      </div>
    </div>
  );
}

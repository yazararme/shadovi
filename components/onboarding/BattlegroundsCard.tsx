"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Pencil } from "lucide-react";
interface Props {
  battlegrounds: string[];
  onChange: (updated: string[]) => void;
}

export function BattlegroundsCard({ battlegrounds, onChange }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(battlegrounds.join("\n"));

  function handleBlur() {
    setEditing(false);
    const updated = draft.split("\n").map((s) => s.trim()).filter(Boolean);
    onChange(updated);
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Strategic Battlegrounds
            </CardTitle>
            {!editing && (
              <Pencil
                className="h-3 w-3 text-muted-foreground cursor-pointer"
                onClick={() => { setEditing(true); setDraft(battlegrounds.join("\n")); }}
              />
            )}
          </div>
          <Badge variant="secondary" className="text-xs">Query anchor</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground mb-3">
          Competitive contexts where your brand should be winning the AI narrative. These anchor your comparative and validation queries.
        </p>
        {editing ? (
          <Textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={handleBlur}
            className="text-xs min-h-[120px]"
            placeholder="One battleground per line, e.g.:&#10;Compliance-first vs flexibility&#10;SMB vs enterprise pricing"
          />
        ) : (
          <ul
            onClick={() => { setEditing(true); setDraft(battlegrounds.join("\n")); }}
            className="space-y-1 cursor-text"
          >
            {battlegrounds.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className="text-muted-foreground mt-0.5">–</span>
                <span>{item}</span>
              </li>
            ))}
            {battlegrounds.length === 0 && (
              <li className="text-xs text-muted-foreground italic">Click to add competitive contexts…</li>
            )}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

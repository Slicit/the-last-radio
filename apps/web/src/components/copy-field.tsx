import { useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Read-only value with a copy button. navigator.clipboard only exists on
 * HTTPS/localhost, and the radio is often served over plain HTTP on a LAN,
 * so fall back to selecting the text and execCommand("copy").
 */
export function CopyField({ value, className, mono = true }: { value: string; className?: string; mono?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(value);
      ok = true;
    } catch {
      ref.current?.select();
      ok = document.execCommand("copy");
    }
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } else {
      ref.current?.select(); // at least leave it selected for Ctrl+C
    }
  };

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <input
        ref={ref}
        readOnly
        value={value}
        onFocus={(e) => e.currentTarget.select()}
        className={cn(
          "h-9 min-w-0 flex-1 rounded-md border bg-muted/40 px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          mono && "font-mono text-xs",
        )}
      />
      <Button type="button" variant="outline" size="icon" onClick={copy} aria-label={copied ? "Copied" : "Copy"}>
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  );
}

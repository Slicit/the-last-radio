import { useId, useMemo, useState, type MouseEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";

type Point = { t: string; avg: number; peak: number };
type Series = { points: Point[]; peak: number; peakAt: string | null; avg: number };
type ListenerStats = {
  range: Range;
  from: string;
  to: string;
  bucketSec: number;
  all: Series;
  stations: (Series & { station: { id: string; slug: string; name: string; isPrivate: boolean } })[];
};
type Range = "24h" | "7d" | "30d" | "90d";

const RANGES: { value: Range; label: string }[] = [
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "3 months" },
];

const when = (iso: string, range: Range) =>
  new Date(iso).toLocaleString(undefined, range === "24h" ? { hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short", hour: range === "90d" ? undefined : "2-digit", minute: range === "90d" ? undefined : "2-digit" });

/**
 * Average listeners as an area and peaks as a line, drawn as plain SVG over
 * the whole range (gaps where nothing was recorded). Hover for a period's numbers.
 */
function ListenerChart({ series, from, to, range, height = 160, label }: { series: Series; from: string; to: string; range: Range; height?: number; label: string }) {
  const gradient = useId();
  const [hover, setHover] = useState<Point | null>(null);
  const W = 600;
  const H = height;
  const pad = { top: 8, bottom: 18, left: 28, right: 6 };
  const t0 = Date.parse(from);
  const t1 = Date.parse(to);
  const top = Math.max(1, series.peak);
  const x = (t: string) => pad.left + ((Date.parse(t) - t0) / (t1 - t0)) * (W - pad.left - pad.right);
  const y = (v: number) => pad.top + (1 - v / top) * (H - pad.top - pad.bottom);

  const { area, peakLine } = useMemo(() => {
    // Split into runs wherever a period is missing, so gaps stay gaps.
    const step = series.points.length > 1 ? Math.min(...series.points.slice(1).map((p, i) => Date.parse(p.t) - Date.parse(series.points[i].t))) : 0;
    const runs: Point[][] = [];
    for (const p of series.points) {
      const last = runs.at(-1)?.at(-1);
      if (last && Date.parse(p.t) - Date.parse(last.t) <= step * 1.5) runs.at(-1)!.push(p);
      else runs.push([p]);
    }
    const base = y(0);
    return {
      area: runs
        .map((r) => `M${x(r[0].t)},${base} ` + r.map((p) => `L${x(p.t)},${y(p.avg)}`).join(" ") + ` L${x(r.at(-1)!.t)},${base} Z`)
        .join(" "),
      peakLine: runs.map((r) => r.map((p, i) => `${i ? "L" : "M"}${x(p.t)},${y(p.peak)}`).join(" ")).join(" "),
    };
  }, [series, from, to, height]);

  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    let best: Point | null = null;
    for (const p of series.points) if (!best || Math.abs(x(p.t) - px) < Math.abs(x(best.t) - px)) best = p;
    setHover(best);
  };

  if (!series.points.length) {
    return <div className="grid place-items-center rounded-md bg-muted/40 text-sm text-muted-foreground" style={{ height }}>No listeners recorded in this period yet.</div>;
  }

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height }}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${label}: peak ${series.peak}, average ${series.avg}`}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.45" />
            <stop offset="100%" stopColor="var(--brand)" stopOpacity="0.05" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={pad.left} x2={W - pad.right} y1={y(top * f)} y2={y(top * f)} stroke="var(--border)" strokeDasharray={f ? "3 3" : undefined} vectorEffect="non-scaling-stroke" />
            <text x={pad.left - 4} y={y(top * f) + 3} textAnchor="end" fontSize="10" fill="var(--muted-foreground)">
              {Math.round(top * f)}
            </text>
          </g>
        ))}
        <path d={area} fill={`url(#${gradient})`} />
        <path d={peakLine} fill="none" stroke="var(--brand)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        {hover && <line x1={x(hover.t)} x2={x(hover.t)} y1={pad.top} y2={H - pad.bottom} stroke="var(--foreground)" strokeOpacity="0.4" vectorEffect="non-scaling-stroke" />}
        <text x={pad.left} y={H - 4} fontSize="10" fill="var(--muted-foreground)">{when(from, range)}</text>
        <text x={W - pad.right} y={H - 4} fontSize="10" textAnchor="end" fill="var(--muted-foreground)">now</text>
      </svg>
      {hover && (
        <div className="pointer-events-none absolute top-1 right-2 rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-sm">
          {when(hover.t, range)} · avg <strong>{hover.avg}</strong> · peak <strong>{hover.peak}</strong>
        </div>
      )}
    </div>
  );
}

const Figures = ({ s, range }: { s: Series; range: Range }) => (
  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
    <span>
      Peak <strong className="text-foreground tabular-nums">{s.peak}</strong>
      {s.peakAt && <> ({when(s.peakAt, range)})</>}
    </span>
    <span>
      Average <strong className="text-foreground tabular-nums">{s.avg}</strong>
    </span>
  </div>
);

/** Admin: listeners over time, all stations together and each one. */
export function ListenerStatsAdmin() {
  const [range, setRange] = useState<Range>("7d");
  const { data, isLoading } = useQuery({
    queryKey: ["listener-stats", range],
    queryFn: () => api.get<ListenerStats>(`/admin/listeners?range=${range}`),
    placeholderData: (prev) => prev,
    refetchInterval: 5 * 60_000,
  });

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <CardTitle>Listeners</CardTitle>
          <CardDescription>People listening, counted every 5 minutes. The line is the peak, the shaded area the average.</CardDescription>
        </div>
        <div className="flex gap-1" role="radiogroup" aria-label="Period">
          {RANGES.map((r) => (
            <Button key={r.value} type="button" size="sm" role="radio" aria-checked={range === r.value} variant={range === r.value ? "secondary" : "ghost"} onClick={() => setRange(r.value)}>
              {r.label}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoading || !data ? (
          <Skeleton className="h-40" />
        ) : (
          <>
            <section aria-label="All stations" className="space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-medium">All stations</h3>
                <Figures s={data.all} range={data.range} />
              </div>
              <ListenerChart series={data.all} from={data.from} to={data.to} range={data.range} label="All stations" />
            </section>
            {data.stations.length > 0 && (
              <div className="grid gap-5 md:grid-cols-2">
                {data.stations.map((s) => (
                  <section key={s.station.id} aria-label={s.station.name} className="space-y-1.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="inline-flex items-center gap-1 text-sm font-medium">
                        {s.station.isPrivate && <Lock className="size-3" aria-label="Private" />}
                        {s.station.name}
                      </h3>
                      <Figures s={s} range={data.range} />
                    </div>
                    <ListenerChart series={s} from={data.from} to={data.to} range={data.range} height={100} label={s.station.name} />
                  </section>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

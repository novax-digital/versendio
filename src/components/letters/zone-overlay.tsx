import { ZONES, MARGINS, A4, zoneToPercent } from "@/lib/shared/schablone";

// Fractional overlay of the Schablone V3 zones, laid over an A4 preview surface.
const zones = [
  { key: "sender", zone: ZONES.senderLine, label: "Absender", color: "border-sky-500 bg-sky-500/10" },
  { key: "dvf", zone: ZONES.dvfBlocked, label: "Sperrbereich", color: "border-red-500 bg-red-500/10" },
  { key: "recipient", zone: ZONES.recipient, label: "Empfänger", color: "border-emerald-500 bg-emerald-500/10" },
];

/** Absolute-positioned zone rectangles for overlaying an A4 preview (aspect 210:297). */
export function ZoneOverlay({ show }: { show: boolean }) {
  if (!show) return null;
  const leftStrip = {
    left: 0,
    top: 0,
    width: (MARGINS.leftStripMm / A4.widthMm) * 100,
    height: 100,
  };
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      <div
        className="absolute border-r border-dashed border-amber-500 bg-amber-500/5"
        style={{
          left: `${leftStrip.left}%`,
          top: `${leftStrip.top}%`,
          width: `${leftStrip.width}%`,
          height: `${leftStrip.height}%`,
        }}
      />
      {zones.map(({ key, zone, label, color }) => {
        const p = zoneToPercent(zone);
        return (
          <div
            key={key}
            className={`absolute border ${color}`}
            style={{ left: `${p.left}%`, top: `${p.top}%`, width: `${p.width}%`, height: `${p.height}%` }}
          >
            <span className="bg-background/70 absolute left-0 top-0 px-1 text-[9px] font-medium">
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

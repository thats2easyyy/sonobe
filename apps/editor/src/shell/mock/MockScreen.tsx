import type { DevicePreset } from "@sonobe/core";
import { Heart, House, MapPin, Search, Ticket, UserRound } from "lucide-react";
import type { CSSProperties } from "react";
import "./MockScreen.css";

export interface MockScreenProps {
  device: DevicePreset;
  /** Draw a selection outline with handles on this element (canvas). */
  selected?: "card" | null;
  /** 1 / artboard scale, so outlines and handles stay crisp at any zoom. */
  inverseScale?: number;
  /** Play the entrance animation (viewer restart). */
  animate?: boolean;
}

/** The fictional “Popular Events” prototype, drawn with CSS at device size in points. */
export function MockScreen({ device, selected = null, inverseScale = 1, animate = false }: MockScreenProps) {
  const [width, height] = device.size;
  const style = {
    width,
    height,
    "--sb-safe-top": `${Math.max(device.safeArea[0], 24)}px`,
    "--sb-safe-bottom": `${device.safeArea[2]}px`,
    "--sb-inv-scale": inverseScale,
  } as CSSProperties;
  return (
    <div className="sb-mock" style={style} data-animate={animate || undefined}>
      <div className="sb-mock__status">
        <span>9:41</span>
        <span className="sb-mock__status-icons" aria-hidden>
          <i />
          <i />
          <b />
        </span>
      </div>
      <div className="sb-mock__content">
        <div className="sb-mock__header">
          <div>
            <div className="sb-mock__eyebrow">
              <MapPin size={13} strokeWidth={2.5} /> San Francisco · This weekend
            </div>
            <div className="sb-mock__title">Popular Events</div>
          </div>
          <div className="sb-mock__avatar" />
        </div>
        <div className="sb-mock__chips">
          <span data-active>All</span>
          <span>Music</span>
          <span>Food</span>
          <span>Outdoors</span>
        </div>
        <div className="sb-mock__card" data-hit data-selected={selected === "card" || undefined}>
          <div className="sb-mock__photo" data-variant="sunset">
            <span className="sb-mock__sun" />
            <span className="sb-mock__hills" />
          </div>
          <div className="sb-mock__scrim" />
          <div className="sb-mock__like" data-hit>
            <Heart size={19} fill="currentColor" strokeWidth={0} />
          </div>
          <div className="sb-mock__card-body">
            <div className="sb-mock__card-title">Rooftop Jazz Night</div>
            <div className="sb-mock__card-meta">Sat · 8 PM · Mission District</div>
          </div>
          {selected === "card" && (
            <div className="sb-mock__selection" aria-hidden>
              {["nw", "n", "ne", "e", "se", "s", "sw", "w"].map((handle) => (
                <span key={handle} className="sb-mock__handle" data-handle={handle} />
              ))}
              <span className="sb-mock__size">{width - 40} × 260</span>
            </div>
          )}
        </div>
        <div className="sb-mock__card" data-small data-hit>
          <div className="sb-mock__photo" data-variant="park" />
          <div className="sb-mock__scrim" />
          <div className="sb-mock__card-body">
            <div className="sb-mock__card-title">Dolores Park Picnic</div>
            <div className="sb-mock__card-meta">Sun · Noon · 214 going</div>
          </div>
        </div>
      </div>
      <div className="sb-mock__tabbar">
        <span data-active data-hit>
          <House size={24} strokeWidth={2} />
        </span>
        <span data-hit>
          <Search size={24} strokeWidth={2} />
        </span>
        <span data-hit>
          <Ticket size={24} strokeWidth={2} />
        </span>
        <span data-hit>
          <UserRound size={24} strokeWidth={2} />
        </span>
      </div>
      {height > 700 && <div className="sb-mock__home-indicator" />}
    </div>
  );
}

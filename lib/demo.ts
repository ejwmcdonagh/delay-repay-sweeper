import type { ArrivalProvider, RouteService } from "./arrival/provider.js";
import type { Route } from "./routes.js";

// A demo watched route so the app is visible out of the box with no credentials.
export function demoRoute(): Route {
  return { id: "demo-route", label: "Morning commute", origin: "London Waterloo", destination: "Brighton", fromTime: "06:30", toTime: "10:00" };
}

const late = (scheduled: Date, mins: number) => new Date(scheduled.getTime() + mins * 60_000);

// Scripted provider for the demo route to Brighton: returns a board with two delayed trains
// (22 and 18 min) and one on-time, so route monitoring surfaces a delay with no credentials.
// (getActualArrival's MAN/EDB entries are leftover fixtures used by unit tests.)
export class DemoArrivalProvider implements ArrivalProvider {
  private readonly late: Record<string, number> = { MAN: 27, EDB: 5 };

  async getActualArrival(crs: string, scheduled: Date): Promise<Date | null> {
    const m = this.late[crs];
    return m === undefined ? null : late(scheduled, m);
  }

  async servicesInWindow(crs: string, date: Date, _from: string, _to: string): Promise<RouteService[]> {
    if (crs !== "BTN") return [];
    const at = (hhmm: string) => {
      const d = new Date(date);
      d.setUTCHours(Number(hhmm.slice(0, 2)), Number(hhmm.slice(3)), 0, 0);
      return d;
    };
    // originCrs = Waterloo, so they survive the origin filter for the demo Waterloo→Brighton route.
    return [
      { scheduledArrival: at("08:30"), actualArrival: late(at("08:30"), 22), originCrs: "WAT" }, // delayed
      { scheduledArrival: at("08:50"), actualArrival: late(at("08:50"), 18), originCrs: "WAT" }, // delayed (2nd candidate)
      { scheduledArrival: at("09:00"), actualArrival: late(at("09:00"), 3), originCrs: "WAT" }, // on time -> ignored
    ];
  }
}

export function demoProvider(): DemoArrivalProvider {
  return new DemoArrivalProvider();
}

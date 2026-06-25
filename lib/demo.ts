import type { ArrivalProvider, RouteService } from "./arrival/provider.js";
import type { RawEmail } from "./parsers/types.js";
import type { Route } from "./routes.js";

// Sample receipts so the app runs end-to-end with zero credentials. One eligible delay, one
// on-time recovery (TC-001 shape), one still-pending arrival.
const receipt = (from: string, ref: string, route: string, times: string, type: string, total: string): RawEmail => ({
  from,
  subject: "Your booking is confirmed",
  body: [`Booking reference: ${ref}`, route, `Wed 24 Jun 2026, ${times}`, `Ticket type: ${type}`, `Total: ${total}`].join("\n"),
});

export function demoEmails(): RawEmail[] {
  return [
    receipt("noreply@avantiwestcoast.co.uk", "AB12CD", "London Euston to Manchester Piccadilly", "dep 14:30 arr 16:38", "Single", "£40.00"),
    receipt("tickets@lner.co.uk", "ZZ99XY", "London Kings Cross to Edinburgh", "dep 10:00 arr 14:20", "Return", "£120.00"),
    receipt("noreply@gwr.com", "GW77QP", "London Paddington to Reading", "dep 09:00 arr 09:25", "Single", "£15.00"),
  ];
}

// A demo watched route so the no-email path is visible out of the box.
export function demoRoute(): Route {
  return { id: "demo-route", label: "Morning commute", origin: "London Waterloo", destination: "Brighton", fromTime: "06:30", toTime: "10:00" };
}

const late = (scheduled: Date, mins: number) => new Date(scheduled.getTime() + mins * 60_000);

// Scripted provider: Manchester 27 min late (eligible email), Edinburgh 5 min (on-time),
// Reading not reported (pending). For the demo route to Brighton it returns a board with one
// delayed train (22 min) and one on-time, so route monitoring surfaces a delay with no email.
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
    return [
      { scheduledArrival: at("08:30"), actualArrival: late(at("08:30"), 22) }, // delayed
      { scheduledArrival: at("08:50"), actualArrival: late(at("08:50"), 18) }, // delayed (2nd candidate)
      { scheduledArrival: at("09:00"), actualArrival: late(at("09:00"), 3) }, // on time -> ignored
    ];
  }
}

export function demoProvider(): DemoArrivalProvider {
  return new DemoArrivalProvider();
}

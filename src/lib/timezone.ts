// Convert a naive `datetime-local` string ("YYYY-MM-DDTHH:mm", no offset) that
// represents wall-clock time in `timeZone` into the true UTC instant. The old
// code used `new Date(naive)` which silently parses in the SERVER timezone,
// publishing scheduled posts hours early (audit finding DATA-8).
export function zonedNaiveToUtc(naive: string, timeZone: string): Date {
  // Read the wall-clock digits as if they were UTC. This instant is wrong by
  // exactly the zone's offset, which we then measure and subtract out.
  const asIfUtc = new Date(`${naive}Z`);
  if (Number.isNaN(asIfUtc.getTime())) throw new Error(`Invalid datetime: ${naive}`);

  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(asIfUtc).map(x => [x.type, x.value]));
  const seenAsUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);

  // offset = (what the wall clock shows in timeZone for this instant) − (the instant itself)
  const offsetMs = seenAsUtc - asIfUtc.getTime();
  return new Date(asIfUtc.getTime() - offsetMs);
}

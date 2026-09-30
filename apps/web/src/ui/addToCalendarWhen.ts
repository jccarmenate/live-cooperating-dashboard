import { formatWall, fromWallMinutes, parseWall, type When, wallMinutes } from '@relay/core';

/**
 * The "Add to calendar" dialog's when: all-day on `date`, or timed `start`–`end` ('HH:mm') on
 * `date` in `zone`. An end at or before the start makes the event one hour long, rolling into
 * the next day after 23:00.
 */
export function addToCalendarWhen(
  date: string,
  allDay: boolean,
  start: string,
  end: string,
  zone: string,
): When {
  if (allDay) return { allDay: true, start: date, end: date };
  const from = `${date}T${start}`;
  if (end > start) return { allDay: false, start: from, end: `${date}T${end}`, tz: zone };
  const wall = parseWall(from);
  const to = wall ? formatWall(fromWallMinutes(wallMinutes(wall) + 60)) : from;
  return { allDay: false, start: from, end: to, tz: zone };
}

import { z } from 'zod';

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:mm requerido');

const daySchema = z.object({ open: timeSchema, close: timeSchema }).nullable();

const weeklySchema = z.partialRecord(
  z.enum(['0', '1', '2', '3', '4', '5', '6']),
  daySchema,
);

export type DayHours = { open: string; close: string } | null;
export type WeeklyHours = Record<Weekday, DayHours>;

export function parseWorkingHours(value: unknown): WeeklyHours {
  const parsed = weeklySchema.parse(value);
  const result = {
    0: null,
    1: null,
    2: null,
    3: null,
    4: null,
    5: null,
    6: null,
  } as WeeklyHours;
  for (const [k, v] of Object.entries(parsed)) {
    result[Number(k) as Weekday] = v ?? null;
  }
  return result;
}

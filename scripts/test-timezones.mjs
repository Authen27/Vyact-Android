// T5a (audit INT-PAR-11): the date-sensitive suites, run once per device time zone.
//
// Every other run of the suite happens in one zone (the developer's, or CI's UTC), so a rule that is only
// right in India time passes everywhere it is tested. "Today", month boundaries, recurrence and the bill
// calendar are each run here under five zones, from UTC-5 to UTC+14 (the first and last places a calendar
// day begins). The SQL suites are left out: Postgres keeps its own zone.
//
//   node scripts/test-timezones.mjs            (from react/)
import { spawnSync } from 'node:child_process';

export const ZONES = ['UTC', 'Asia/Kolkata', 'Europe/London', 'America/New_York', 'Pacific/Kiritimati'];
export const SUITES = [
  'src/lib/__tests__/format.test.ts',
  'src/lib/__tests__/timeZoneDay.test.ts',
  'src/lib/__tests__/reportRange.test.ts',
  'src/lib/__tests__/rrule.test.ts',
  'src/lib/__tests__/recurring.test.ts',
  'src/lib/__tests__/recurrenceEngine.test.ts',
  'src/lib/__tests__/recurrenceServerParity.test.ts',
  'src/lib/__tests__/recurringApproval.test.ts',
  'src/lib/__tests__/billCalendar.test.ts',
  'src/lib/__tests__/loanCalendar.test.ts',
];

const failed = [];
for (const zone of ZONES) {
  const run = spawnSync('npx', ['vitest', 'run', ...SUITES], {
    stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32',
    env: { ...process.env, TZ: zone },
  });
  const out = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  const tests = /Tests\s+(.*)/.exec(out)?.[1]?.trim() ?? '(no summary)';
  console.log(`${run.status === 0 ? '✓' : '✗'} ${zone.padEnd(20)} ${tests}`);
  if (run.status !== 0) { failed.push(zone); console.log(out.split('\n').filter((l) => /FAIL|×|AssertionError|Expected|Received/.test(l)).slice(0, 30).join('\n')); }
}
if (failed.length) { console.error(`\n✗ date-sensitive suites fail in: ${failed.join(', ')}`); process.exit(1); }
console.log(`\n✓ ${SUITES.length} date-sensitive suites pass in ${ZONES.length} time zones.`);

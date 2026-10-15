/** Multi-season balance report: npx tsx scripts/sim-calibration/seasons.ts [seasons] [seed] */
import { simulateSeasons } from "../../src/engine/league/simulate";

const seasons = Number(process.argv[2] ?? 5);
const seed = process.argv[3] ?? "balance-1";
const t0 = Date.now();
const { reports } = simulateSeasons(seed, seasons);
const eur = (c: number) => `€${(c / 100 / 1e6).toFixed(1)}m`;
for (const r of reports) {
  const regulars = r.ovrDeltas.filter((d) => d.minutes >= 1500);
  const est = regulars.filter((d) => d.age !== null && d.age >= 24 && d.age <= 29);
  const young = regulars.filter((d) => d.age !== null && d.age <= 21);
  const vet = r.ovrDeltas.filter((d) => d.age !== null && d.age >= 31);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const big = r.ovrDeltas.filter((d) => d.endOvr - d.startOvr >= 4).length;
  console.log(`S${r.season}: goals ${r.avgGoals.toFixed(2)} draws ${(r.drawRate * 100).toFixed(0)}% avgOVR ${r.avgOvr.toFixed(2)} avgValue ${eur(r.avgValueCents)} ` +
    `debt ${r.clubsInDebt}/18 cash[${eur(r.minCashCents)}..${eur(r.maxCashCents)}] ` +
    `ΔOVR est ${mean(est.map((d) => d.endOvr - d.startOvr)).toFixed(2)} (n${est.length}) young ${mean(young.map((d) => d.endOvr - d.startOvr)).toFixed(2)} (n${young.length}) ` +
    `vet ${mean(vet.map((d) => d.endOvr - d.startOvr)).toFixed(2)} (n${vet.length}) +4ormore ${big}`);
}
console.log(`took ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// Calcoli del report di gara (puro, senza DOM: usato dalla pagina e dai test).
// r = { startedAt, totalKm, checkpoints:[{idx,name,km}], participants:[{id,name,color,stats,passages:[{cp,t}]}] }

export function buildReport(r) {
  const total = r.totalKm;
  const marks = [{ name: 'Partenza', km: 0 }, ...r.checkpoints.map((c) => ({ name: c.name, km: c.km, idx: c.idx })),
    { name: 'Arrivo', km: total }];
  const sectors = [];
  for (let i = 0; i < marks.length - 1; i++) {
    sectors.push({ from: marks[i].name, to: marks[i + 1].name, km: Math.max(0, marks[i + 1].km - marks[i].km) });
  }
  const rows = r.participants.map((p) => {
    const st = p.stats || null;
    const finished = !!(st && total != null && st.distKm >= total - 0.15 && st.elapsedSec > 0);
    // tempo trascorso (s) a ogni segnaposto: partenza, checkpoint, arrivo; null se non rilevato
    const at = [0, ...r.checkpoints.map((c) => {
      const x = p.passages.find((q) => q.cp === c.idx);
      return x && r.startedAt != null ? Math.round((x.t - r.startedAt) / 1000) : null;
    }), finished ? st.elapsedSec : null];
    const cells = sectors.map((s, i) => {
      const a = at[i], b = at[i + 1];
      if (a == null || b == null || b <= a || s.km <= 0) return null;
      const sec = b - a;
      return { sec, paceSecKm: sec / s.km, kmh: s.km / (sec / 3600), best: false, deltaSec: 0 };
    });
    return { id: p.id, name: p.name, color: p.color, finished, totalSec: finished ? st.elapsedSec : null,
      distKm: st ? st.distKm : null, gain: st ? st.gain : null, loss: st ? st.loss : null,
      avgPaceSecKm: st ? st.avgPaceSecKm : null, paceByGrade: st ? st.paceByGrade : null, at, cells };
  });
  // miglior tempo per settore (evidenziato solo se si possono confrontare almeno due corridori)
  sectors.forEach((_, i) => {
    const vals = rows.map((x) => x.cells[i]).filter(Boolean);
    if (!vals.length) return;
    const best = Math.min(...vals.map((v) => v.sec));
    sectors[i].bestSec = best;
    for (const v of vals) { v.deltaSec = v.sec - best; v.best = vals.length >= 2 && v.sec === best; }
  });
  // classifica: prima chi è arrivato (per tempo), poi gli altri per distanza percorsa
  const ranking = [...rows].sort((a, b) => {
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    if (a.finished) return a.totalSec - b.totalSec;
    return (b.distKm ?? 0) - (a.distKm ?? 0);
  });
  const lead = ranking[0]?.finished ? ranking[0].totalSec : null;
  ranking.forEach((x, i) => { x.pos = i + 1; x.gapSec = x.finished && lead != null ? x.totalSec - lead : null; });
  return { sectors, rows, ranking, comparable: rows.length >= 2 };
}

export const fmtDur = (s) => {
  if (s == null || !isFinite(s)) return '–';
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
};
export const fmtPace = (s) => (s == null || !isFinite(s) ? '–' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);
export const fmtGap = (s) => (s == null ? '' : s === 0 ? '' : `+${fmtDur(s)}`);

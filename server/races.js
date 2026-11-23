// Creazione e gestione delle gare (organizzatore e amministratore) e diritti del corridore.
import { HttpError, bad, token, shortId, sha256, safeEqual, hmac } from './util.js';
import { buildCourse, project, haversine, encodePoint, decodePoint, runnerStats } from './geo.js';
import { DAY, KEEP_AFTER_END, SAFETY_TTL, DRAFT_TTL, LIVE_TTL, MAX_PARTICIPANTS, CONSENT_VERSION, MAX_HISTORY, STALE_MS, MAX_BATCH, RATE_PER_MIN, IP_PER_MIN, ANON_REPORT_DAYS, AUTO_END_HOURS, MAX_ACC, MAX_SPEED, MAX_ANOM, OFF_COURSE_M, MAX_PROG_ANOM, COLORS, STATUS_LABEL } from './config.js';

export function createRaces({ common, finish, archive, env, now }) {
  const { repo, loadRace, lifeTtl, saveRace, loadCourse, expireRace, admin, authorize, bearer, viewer, num, text, parseCoursePoints,
    participantStatus, ipId, reportSecret, reportSig, reportToken, reportPath, pubParticipant, pubMeta } = common;
  const { endRace, retryArchive, applyRetention } = finish;

  // ---------- creazione gara (admin e pubblico) ----------
  async function createRace(body, withOrganizer = false) {
    const name = text(body?.name, 80, 'Nome');
    const id = shortId();
    const meta = { id, name, status: 'draft', createdAt: now(), startedAt: null, endedAt: null,
      viewHash: null, orgHash: null, participants: [], checkpoints: [] };
    let course = null;
    if (body.course) {
      course = buildCourse(parseCoursePoints(body.course.points));
      course.name = body.course.name ? String(body.course.name).slice(0, 80) : name;
    }
    const cps = Array.isArray(body.checkpoints) ? body.checkpoints : [];
    if (cps.length > 30) throw bad('Massimo 30 checkpoint');
    if (!cps.every((c) => c && typeof c === 'object')) throw bad('Checkpoint non valido');
    if (cps.length && !course) throw bad('Servono la traccia GPX per i checkpoint');
    meta.checkpoints = cps.map((c, i) => {
      const lat = num(c.lat, -90, 90, 'lat checkpoint'), lon = num(c.lon, -180, 180, 'lon checkpoint');
      return { id: `c${i + 1}`, name: text(c.name, 60, 'Nome checkpoint'), lat, lon,
        km: Math.round(project(course, lat, lon).km * 1000) / 1000,
        auto: c.auto !== false, radius: Math.min(200, Math.max(20, Number(c.radius) || 50)) };
    }).sort((a, b) => a.km - b.km);
    let orgToken = null;
    if (withOrganizer) { orgToken = token(24); meta.orgHash = sha256(orgToken); }
    await saveRace(meta);
    await repo.initRace(meta, course, DRAFT_TTL);
    return { race: pubMeta(meta), course: course && { totalKm: course.totalKm, gain: course.gain, loss: course.loss },
      ...(orgToken ? { organizerToken: orgToken, organizerPath: `/gestisci#${orgToken}` } : {}) };
  }

  // creazione pubblica: limiti per rete (solo hash con sale giornaliero, 1 giorno) e tetto globale
  async function publicCreate(headers, body) {
    const day = Math.floor(now() / 86400000);
    const key = `rc:${ipId(headers)}:${day}`;
    const n = await repo.count(key, 2 * DAY);
    if (n > (Number(env.CREATE_PER_DAY) || 5)) throw new HttpError(429, 'Troppe gare create oggi: riprova domani');
    const active = await repo.activeRaceIds();
    if (active.length >= (Number(env.MAX_ACTIVE_RACES) || 500)) throw new HttpError(503, 'Servizio al completo: riprova tra poco');
    return createRace(body, true);
  }

  // Cancella un corridore: archivio (se la gara è già archiviata) e dati live. Usata da organizzatore e dal corridore stesso.
  async function removeParticipant(m, p) {
    if (archive.enabled && m.status === 'ended' && m.archive?.state === 'done') {
      try { await archive.deleteParticipant(m.id, p.id); }
      catch (e) { console.log(JSON.stringify({ ev: 'delete-failed', race: m.id, err: String(e.message || e).slice(0, 120) })); throw new HttpError(503, 'Cancellazione non riuscita: riprova tra poco'); }
    }
    m.participants = m.participants.filter((x) => x !== p);
    await saveRace(m, m.status === 'ended' && m.archive?.state === 'pending' ? SAFETY_TTL : lifeTtl(m));
    await repo.deleteParticipant(m.id, p);
  }

  // Il corridore, con il proprio codice di accesso, vede cosa è salvato su di lui e può cancellarlo.
  async function deviceMe(headers, method, body) {
    const dev = bearer(headers);
    if (!dev) throw new HttpError(401, 'Credenziale dispositivo mancante');
    const ref = await repo.deviceRef(sha256(dev));
    if (!ref) throw new HttpError(401, 'Dispositivo non autorizzato');
    const m = await loadRace(ref.raceId);
    const p = m.participants.find((x) => x.id === ref.pid);
    if (!p) throw new HttpError(401, 'Dispositivo non autorizzato');
    if (method === 'DELETE') { await removeParticipant(m, p); return { ok: true }; }
    if (method === 'POST') {   // consenso del corridore: solo con questo gesto le sue posizioni vengono accettate
      if (m.status === 'ended') throw new HttpError(410, 'Gara conclusa');
      if (body?.accept !== true || body?.ageOk !== true) throw bad('Serve il consenso esplicito');
      if (!p.consentAt) { p.consentAt = now(); p.consentVersion = CONSENT_VERSION; await saveRace(m); }
      return { ok: true, consentAt: p.consentAt };
    }
    const l = await repo.getLast(m.id, p.id);
    return { name: p.name, raceName: m.name, raceStatus: m.status, consent: !!p.consentAt, consentAt: p.consentAt ?? null, points: l?.n ?? 0 };
  }

  // ---------- rotte amministratore ----------
  async function adminRoutes(method, parts, body, headers, reqOrigin) {
    const scope = await authorize(headers);
    // /admin/races
    if (parts[0] !== 'races') throw new HttpError(404, 'Non trovato');
    if (parts.length === 1) {
      if (method === 'GET') {
        const ids = scope.raceId ? [scope.raceId] : await repo.activeRaceIds();
        const out = [];
        for (const id of ids) {
          const m = await repo.getRace(id);
          if (!m) { await repo.dropActive(id); continue; }
          out.push({ id, name: m.name, status: m.status, createdAt: m.createdAt, participants: m.participants.length });
        }
        return { races: out };
      }
      if (method === 'POST') {
        if (scope.raceId) throw new HttpError(403, 'Non consentito');
        return createRace(body);
      }
      throw new HttpError(405, 'Metodo non consentito');
    }
    if (scope.raceId && parts[1] !== scope.raceId) throw new HttpError(403, 'Non consentito');
    const m = await loadRace(parts[1], { allowExpired: parts[2] === 'archive' });
    const sub = parts[2];
    if (!sub) {
      if (method === 'GET') {
        const last = await repo.getAllLast(m.id);
        const race = pubMeta(m);
        race.participants = race.participants.map((p) => {
          const l = last[p.id] || null;
          return { ...p, received: l ? { rcv: l.rcv, t: l.t, status: l.status, points: l.n ?? null, offCourseM: l.off ?? null,
            lat: l.lat ?? null, lon: l.lon ?? null } : null };
        });
        return { race, serverTime: now() };
      }
      if (method === 'DELETE') {
        if (archive.enabled) {   // prima l'archivio: se non riesce, non si perde il modo di riprovare
          try { await archive.deleteRace(m.id); } catch (e) { console.log(JSON.stringify({ ev: 'delete-failed', race: m.id, err: String(e.message || e).slice(0, 120) })); throw new HttpError(503, 'Cancellazione non riuscita: riprova tra poco'); }
        }
        await repo.deleteRace(m);
        return { ok: true };
      }
    }
    if (sub === 'participants' && method === 'POST' && parts.length === 3) {
      if (m.participants.length >= MAX_PARTICIPANTS) throw bad('Massimo 5 partecipanti');
      const dev = token(24), pid = `p${m.participants.length + 1}${shortId().slice(0, 6)}`;
      const p = { id: pid, name: text(body?.name, 40, 'Nome'),
        color: /^#[0-9a-f]{6}$/i.test(body?.color || '') ? body.color : COLORS[m.participants.length % 5],
        deviceHash: sha256(dev) };
      m.participants.push(p);
      await saveRace(m);
      await repo.putDevice(p.deviceHash, { raceId: m.id, pid }, lifeTtl(m));
      const pairing = Buffer.from(JSON.stringify({ u: reqOrigin, t: dev, n: p.name })).toString('base64url');
      return { participant: pubParticipant(p), deviceToken: dev, pairing };  // il token si vede una sola volta
    }
    if (sub === 'participants' && method === 'POST' && parts.length === 5 && parts[4] === 'token') {
      // codice smarrito: ne genera uno nuovo e invalida il vecchio (il corridore resta lo stesso, i dati restano)
      const p = m.participants.find((x) => x.id === parts[3]);
      if (!p) throw new HttpError(404, 'Partecipante non trovato');
      const dev = token(24), oldHash = p.deviceHash;
      p.deviceHash = sha256(dev);
      await saveRace(m);
      await repo.replaceDevice(p.deviceHash, { raceId: m.id, pid: p.id }, oldHash, lifeTtl(m));
      const pairing = Buffer.from(JSON.stringify({ u: reqOrigin, t: dev, n: p.name })).toString('base64url');
      return { participant: pubParticipant(p), deviceToken: dev, pairing };
    }
    if (sub === 'report' && method === 'POST') {   // nuovo link del report: il vecchio smette di funzionare
      if (!archive.enabled || m.status !== 'ended' || m.archive?.state !== 'done') throw bad('Report non ancora disponibile');
      const salt = token(12);
      try { await archive.setReportSalt(m.id, salt); } catch { throw new HttpError(503, 'Operazione non riuscita: riprova tra poco'); }
      m.reportSalt = salt; await applyRetention(m);
      return { reportPath: reportPath(m) };
    }
    if (sub === 'participants' && method === 'DELETE' && parts.length === 4) {
      const p = m.participants.find((x) => x.id === parts[3]);
      if (!p) throw new HttpError(404, 'Partecipante non trovato');
      await removeParticipant(m, p);
      return { ok: true };
    }
    if (sub === 'link') {
      if (method === 'POST') {
        const ttl = lifeTtl(m);   // il link dura quanto la gara: fino a 24 ore dopo la fine
        const t = token(24), h = sha256(t);
        await repo.setViewLink(m.id, h, m.viewHash, ttl);   // il vecchio link smette di funzionare
        m.viewHash = h; await saveRace(m);
        return { token: t, path: `/live#${t}`, expiresInHours: ttl / 3600 };
      }
      if (method === 'DELETE') {
        if (m.viewHash) await repo.delView(m.viewHash);
        m.viewHash = null; await saveRace(m);
        return { ok: true };
      }
    }
    if ((sub === 'start' || sub === 'end') && method === 'POST') {
      if (m.status === 'ended') throw bad('Gara già conclusa');
      if (sub === 'start') {
        m.status = 'live'; m.startedAt = m.startedAt ?? now(); await saveRace(m);
        await expireRace(m, lifeTtl(m));   // la durata passa a 7 giorni dall'avvio, anche per link e chiavi già create
      }
      else await endRace(m);
      return { race: pubMeta(m) };
    }
    if (sub === 'archive' && method === 'POST') {   // nuovo tentativo manuale di archiviazione
      if (m.status !== 'ended') throw bad('La gara non è conclusa');
      if (m.archive?.state !== 'done') await retryArchive(m);
      return { archive: m.archive };
    }
    if (sub === 'passage' && method === 'POST') {  // checkpoint manuale
      const cp = m.checkpoints.find((c) => c.id === body?.checkpointId);
      const p = m.participants.find((x) => x.id === body?.participantId);
      if (!cp || !p) throw new HttpError(404, 'Checkpoint o partecipante non trovato');
      const t = body.t == null ? now() : num(body.t, now() - 7 * DAY * 1000, now() + 120000, 't');
      await repo.setPassage(m.id, `${cp.id}:${p.id}`, t);
      return { ok: true, t };
    }
    throw new HttpError(404, 'Non trovato');
  }


  return { createRace, publicCreate, removeParticipant, deviceMe, adminRoutes };
}

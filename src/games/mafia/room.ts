import { Room, Client, CloseCode } from "colyseus";
import { MafiaState, MafiaPlayer, LogEntry } from "./state.js";
import { verifyAuthRequest } from "../../auth/token-verify.js";
import { Spectator, isSpectator } from "../../common/colyseus/spectator.js";
import { pickMasks } from "../../common/colyseus/mask-nicknames.js";
import {
  MIN_PLAYERS,
  MAX_PLAYERS,
  PHASE_MS,
  ROLE,
  ROLE_NAMES_KR,
  type Role,
  checkWinner,
  rolesFor,
  shuffle,
} from "./rules.js";

type JoinOptions = {
  token?: string;
  roomName?: string;
  maxPlayers?: number;
  maskNicknames?: boolean;
};

type NightAction = { kind: "wolf" | "doctor" | "seer"; targetId: string };

type RoundStore = {
  // server-only role book — never put in schema
  roles: Map<string, Role>;
  // night collected actions, keyed by acting sessionId
  wolfPicks: Map<string, string>; // wolf sid -> victim sid
  doctorPick: string;
  seerPick: string;
  lastDoctorProtect: string;
};

const newStore = (): RoundStore => ({
  roles: new Map(),
  wolfPicks: new Map(),
  doctorPick: "",
  seerPick: "",
  lastDoctorProtect: "",
});

export class MafiaRoom extends Room {
  state = new MafiaState();
  maxClients = MAX_PLAYERS;
  autoDispose = true;
  seatReservationTimeout = 15;
  private store: RoundStore = newStore();
  private phaseTimer: ReturnType<typeof setTimeout> | null = null;

  onCreate(options: JoinOptions) {
    this.state.roomName = (options.roomName || "Room").slice(0, 24);
    this.state.maxPlayers = Math.min(
      MAX_PLAYERS,
      Math.max(MIN_PLAYERS, options.maxPlayers || 8),
    );
    this.state.maskNicknames = Boolean(options.maskNicknames);
    this.maxClients = this.state.maxPlayers;
    this.setMetadata({ roomName: this.state.roomName });

    this.onMessage("toggleReady", (client) => {
      if (isSpectator(client)) return;
      const p = this.state.players.get(client.sessionId);
      if (!p || this.state.phase !== "lobby") return;
      p.ready = !p.ready;
    });

    this.onMessage("startGame", (client) => {
      if (isSpectator(client)) return;
      if (client.sessionId !== this.state.hostSessionId) return;
      if (this.state.phase !== "lobby") return;
      if (this.state.players.size < MIN_PLAYERS) return;
      const allReady = Array.from(this.state.players.values()).every(
        (p) => p.ready || p.sessionId === this.state.hostSessionId,
      );
      if (!allReady) return;
      this.startGame();
    });

    this.onMessage("chat", (client, msg: string) => {
      if (isSpectator(client)) return;
      const p = this.state.players.get(client.sessionId);
      if (!p || typeof msg !== "string") return;
      this.pushLog(`💬 ${p.nickname}: ${msg.slice(0, 160)}`, {
        kind: "info",
        actor: p.nickname,
      });
    });

    this.onMessage("wolfChat", (client, msg: string) => {
      if (isSpectator(client)) return;
      const p = this.state.players.get(client.sessionId);
      if (!p || !p.alive) return;
      if (this.store.roles.get(client.sessionId) !== ROLE.WOLF) return;
      if (this.state.phase !== "night") return;
      if (typeof msg !== "string" || !msg.trim()) return;
      const payload = {
        fromNickname: p.nickname,
        text: msg.slice(0, 160),
        ts: Date.now(),
      };
      for (const c of this.clients) {
        if (this.store.roles.get(c.sessionId) === ROLE.WOLF) c.send("wolfChat", payload);
      }
    });

    this.onMessage("nightAction", (client, payload: NightAction) => {
      if (isSpectator(client)) return;
      this.handleNightAction(client, payload);
    });

    this.onMessage("vote", (client, payload: { targetId: string | null }) => {
      if (isSpectator(client)) return;
      this.handleVote(client, payload?.targetId ?? null);
    });
  }

  async onAuth(_client: Client, options: JoinOptions) {
    if (!options.token) throw new Error("토큰 없음");
    const payload = await verifyAuthRequest(options.token);
    if (!payload) {
      throw new Error(
        "다른 브라우저에서 로그인되었거나 토큰이 만료되었습니다",
      );
    }
    return payload;
  }

  onJoin(client: Client, options: JoinOptions & { spectator?: boolean }, auth: any) {
    if (options?.spectator) {
      client.userData = { spectator: true };
      const s = new Spectator();
      s.sessionId = client.sessionId;
      s.userId = auth.userId;
      s.nickname = auth.nickname;
      this.state.spectators.set(client.sessionId, s);
      this.pushLog(`👁 ${auth.nickname} 관전 시작`, {
        kind: "system",
        actor: auth.nickname,
      });
      return;
    }

    if (this.state.phase !== "lobby") {
      throw new Error("게임이 이미 시작됨");
    }
    const player = new MafiaPlayer();
    player.sessionId = client.sessionId;
    player.userId = auth.userId;
    player.nickname = auth.nickname;
    this.state.players.set(client.sessionId, player);

    if (!this.state.hostSessionId) {
      this.state.hostSessionId = client.sessionId;
    }
    this.pushLog(`${player.nickname} 님 입장`, {
      kind: "system",
      actor: player.nickname,
    });
  }

  async onLeave(client: Client, code?: number) {
    if (this.state.spectators.has(client.sessionId)) {
      const s = this.state.spectators.get(client.sessionId);
      this.state.spectators.delete(client.sessionId);
      if (s) {
        this.pushLog(`👁 ${s.nickname} 관전 종료`, {
          kind: "system",
          actor: s.nickname,
        });
      }
      return;
    }
    const p = this.state.players.get(client.sessionId);
    if (!p) return;
    p.connected = false;
    const consented = code === CloseCode.CONSENTED;

    if (this.state.phase === "lobby") {
      this.state.players.delete(client.sessionId);
      if (this.state.hostSessionId === client.sessionId) {
        const next = this.state.players.keys().next().value;
        this.state.hostSessionId = next || "";
      }
      this.pushLog(`${p.nickname} 님 퇴장`, {
        kind: "system",
        actor: p.nickname,
      });
      this.disposeIfBelowMin();
      return;
    }

    try {
      if (consented) throw new Error("consented leave");
      await this.allowReconnection(client, 30);
      p.connected = true;
      this.pushLog(`${p.nickname} 님 재접속`, {
        kind: "system",
        actor: p.nickname,
      });
      // Resend private context to the reconnected client
      this.resendPrivate(client);
    } catch {
      if (p.alive) {
        p.alive = false;
        const role = this.store.roles.get(client.sessionId);
        if (role) p.revealedRole = role;
        this.pushLog(`${p.nickname} 님 연결 끊김 - 사망 처리`, {
          kind: "system",
          actor: p.nickname,
        });
      }
      this.state.players.delete(client.sessionId);
      this.checkGameEnd();
      this.disposeIfBelowMin();
    }
  }

  private disposeIfBelowMin() {
    if (this.state.players.size === 0) {
      this.clearPhaseTimer();
      this.disconnect().catch(() => {});
      return;
    }
    if (
      this.state.phase !== "lobby" &&
      this.aliveCount() < 2
    ) {
      this.pushLog(`👋 인원 부족으로 방이 종료됩니다`, { kind: "system" });
      this.clock.setTimeout(() => this.disconnect().catch(() => {}), 600);
    }
  }

  // ─── Game flow ──────────────────────────────────────────────────

  private startGame() {
    // Assign roles
    const ids = Array.from(this.state.players.keys());
    const roles = shuffle(rolesFor(ids.length));
    this.store = newStore();
    ids.forEach((sid, i) => {
      const role = roles[i];
      this.store.roles.set(sid, role);
      const p = this.state.players.get(sid);
      if (!p) return;
      p.alive = true;
      p.revealedRole = "";
      p.voteTarget = "";
    });

    // Apply nickname masking (before wolfTeam is broadcast so wolves see masked names too).
    if (this.state.maskNicknames) {
      const players = ids
        .map((sid) => this.state.players.get(sid))
        .filter((p): p is MafiaPlayer => !!p);
      const masks = pickMasks(players.length);
      players.forEach((p, i) => { p.nickname = masks[i]; });
      this.pushLog("🎭 닉네임이 가려졌습니다", { kind: "system" });
    }

    // Tell each client their role
    for (const c of this.clients) {
      const role = this.store.roles.get(c.sessionId);
      if (role) c.send("role", { role });
    }
    // Tell wolves about each other
    const wolfIds = ids.filter((s) => this.store.roles.get(s) === ROLE.WOLF);
    const wolfTeam = wolfIds.map((sid) => ({
      sessionId: sid,
      nickname: this.state.players.get(sid)?.nickname ?? "",
    }));
    for (const c of this.clients) {
      if (this.store.roles.get(c.sessionId) === ROLE.WOLF) {
        c.send("wolfTeam", { wolves: wolfTeam });
      }
    }

    this.state.dayCount = 0;
    this.state.lastKilledId = "";
    this.state.lastLynchedId = "";
    this.state.lastNightSaved = false;
    this.state.winners = "";
    this.pushLog("🎴 게임 시작 — 각자 자신의 역할을 확인하세요", { kind: "system" });

    // Brief reveal beat before first night
    this.setPhase("roleReveal", PHASE_MS.roleReveal, () => this.toNight());
  }

  private toNight() {
    this.state.dayCount += 1;
    this.store.wolfPicks.clear();
    this.store.doctorPick = "";
    this.store.seerPick = "";
    for (const p of this.state.players.values()) p.voteTarget = "";
    this.pushLog(`🌙 ${this.state.dayCount}일째 밤이 찾아옵니다`, { kind: "system" });
    this.setPhase("night", PHASE_MS.night, () => this.resolveNight());
  }

  private resolveNight() {
    // Wolf victim = mode of wolfPicks; tie-break: first submitted
    let victim = "";
    if (this.store.wolfPicks.size > 0) {
      const counts = new Map<string, number>();
      for (const pick of this.store.wolfPicks.values()) {
        counts.set(pick, (counts.get(pick) ?? 0) + 1);
      }
      let bestCount = 0;
      for (const [sid, c] of counts) {
        if (c > bestCount) {
          bestCount = c;
          victim = sid;
        }
      }
    }

    const saved = victim !== "" && victim === this.store.doctorPick;
    this.state.lastKilledId = saved ? "" : victim;
    this.state.lastNightSaved = saved;

    if (!saved && victim) {
      const v = this.state.players.get(victim);
      if (v && v.alive) {
        v.alive = false;
        v.revealedRole = this.store.roles.get(victim) ?? "";
        this.pushLog(`🐺 ${v.nickname} 님이 늑대에게 습격당했습니다`, {
          kind: "system",
          actor: v.nickname,
        });
      }
    } else if (saved) {
      const v = this.state.players.get(victim);
      this.pushLog(`✨ 조용한 밤이었습니다${v ? ` (${v.nickname} 보호됨)` : ""}`, {
        kind: "system",
      });
    } else {
      this.pushLog(`🤫 늑대가 행동하지 않았습니다`, { kind: "system" });
    }

    // Seer result — send privately to seer
    const seerEntry = Array.from(this.store.roles.entries()).find(
      ([, role]) => role === ROLE.SEER,
    );
    if (seerEntry && this.store.seerPick) {
      const [seerSid] = seerEntry;
      const seerClient = this.clients.find((c) => c.sessionId === seerSid);
      const targetRole = this.store.roles.get(this.store.seerPick);
      const targetPlayer = this.state.players.get(this.store.seerPick);
      if (seerClient && targetPlayer) {
        seerClient.send("seerResult", {
          targetId: this.store.seerPick,
          nickname: targetPlayer.nickname,
          isWolf: targetRole === ROLE.WOLF,
          dayCount: this.state.dayCount,
        });
      }
    }

    this.store.lastDoctorProtect = this.store.doctorPick;

    if (this.checkGameEnd()) return;

    this.setPhase("nightReveal", PHASE_MS.nightReveal, () => this.toDay());
  }

  private toDay() {
    this.pushLog(`☀️ ${this.state.dayCount}일째 낮 — 토론`, { kind: "system" });
    this.setPhase("day", PHASE_MS.day, () => this.toVote());
  }

  private toVote() {
    for (const p of this.state.players.values()) p.voteTarget = "";
    this.pushLog(`🗳 투표 시간`, { kind: "system" });
    this.setPhase("vote", PHASE_MS.vote, () => this.resolveVote());
  }

  private resolveVote() {
    // Tally
    const counts = new Map<string, number>();
    for (const p of this.state.players.values()) {
      if (!p.alive) continue;
      if (!p.voteTarget) continue;
      counts.set(p.voteTarget, (counts.get(p.voteTarget) ?? 0) + 1);
    }
    let topCount = 0;
    let topSid = "";
    let tie = false;
    for (const [sid, c] of counts) {
      if (c > topCount) {
        topCount = c;
        topSid = sid;
        tie = false;
      } else if (c === topCount) {
        tie = true;
      }
    }

    if (!tie && topSid) {
      const v = this.state.players.get(topSid);
      if (v) {
        v.alive = false;
        v.revealedRole = this.store.roles.get(topSid) ?? "";
        this.state.lastLynchedId = topSid;
        this.pushLog(
          `⚖️ ${v.nickname} 님이 처형되었습니다 (${ROLE_NAMES_KR[(v.revealedRole as Role)] ?? v.revealedRole})`,
          { kind: "system", actor: v.nickname },
        );
      }
    } else {
      this.state.lastLynchedId = "";
      this.pushLog(`🤷 동률 — 아무도 처형되지 않았습니다`, { kind: "system" });
    }

    if (this.checkGameEnd()) return;

    this.setPhase("voteReveal", PHASE_MS.voteReveal, () => this.toNight());
  }

  private handleNightAction(client: Client, payload: NightAction) {
    if (this.state.phase !== "night") return;
    if (!payload || !payload.kind || !payload.targetId) return;
    const role = this.store.roles.get(client.sessionId);
    if (!role) return;
    const p = this.state.players.get(client.sessionId);
    if (!p || !p.alive) return;
    const target = this.state.players.get(payload.targetId);
    if (!target || !target.alive) return;

    if (payload.kind === "wolf") {
      if (role !== ROLE.WOLF) return;
      // Can't target a wolf
      if (this.store.roles.get(payload.targetId) === ROLE.WOLF) return;
      this.store.wolfPicks.set(client.sessionId, payload.targetId);
    } else if (payload.kind === "doctor") {
      if (role !== ROLE.DOCTOR) return;
      if (payload.targetId === this.store.lastDoctorProtect) return; // no two-in-a-row
      this.store.doctorPick = payload.targetId;
    } else if (payload.kind === "seer") {
      if (role !== ROLE.SEER) return;
      if (payload.targetId === client.sessionId) return;
      this.store.seerPick = payload.targetId;
    }

    // Early-resolve: have all expected actors submitted?
    if (this.allNightActionsIn()) {
      this.clearPhaseTimer();
      this.resolveNight();
    }
  }

  private allNightActionsIn(): boolean {
    let wolves = 0;
    let doctors = 0;
    let seers = 0;
    for (const [sid, r] of this.store.roles) {
      const p = this.state.players.get(sid);
      if (!p || !p.alive) continue;
      if (r === ROLE.WOLF) wolves++;
      if (r === ROLE.DOCTOR) doctors++;
      if (r === ROLE.SEER) seers++;
    }
    if (wolves > 0 && this.store.wolfPicks.size < wolves) return false;
    if (doctors > 0 && !this.store.doctorPick) return false;
    if (seers > 0 && !this.store.seerPick) return false;
    return true;
  }

  private handleVote(client: Client, targetId: string | null) {
    if (this.state.phase !== "vote") return;
    const p = this.state.players.get(client.sessionId);
    if (!p || !p.alive) return;
    if (targetId) {
      const t = this.state.players.get(targetId);
      if (!t || !t.alive) return;
      p.voteTarget = targetId;
    } else {
      p.voteTarget = "";
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────

  private checkGameEnd(): boolean {
    let aliveWolves = 0;
    let aliveOthers = 0;
    for (const [sid, r] of this.store.roles) {
      const p = this.state.players.get(sid);
      if (!p || !p.alive) continue;
      if (r === ROLE.WOLF) aliveWolves++;
      else aliveOthers++;
    }
    const winner = checkWinner({ aliveWolves, aliveOthers });
    if (!winner) return false;

    this.state.winners = winner;
    // Reveal all roles
    for (const [sid, r] of this.store.roles) {
      const p = this.state.players.get(sid);
      if (p) p.revealedRole = r;
    }
    this.pushLog(
      winner === "wolves" ? "🐺 늑대의 승리!" : "🌾 시민의 승리!",
      { kind: "result" },
    );
    this.setPhase("gameEnd", 0, () => {});
    return true;
  }

  private resendPrivate(client: Client) {
    const role = this.store.roles.get(client.sessionId);
    if (!role) return;
    client.send("role", { role });
    if (role === ROLE.WOLF) {
      const wolves: { sessionId: string; nickname: string }[] = [];
      for (const [sid, r] of this.store.roles) {
        if (r !== ROLE.WOLF) continue;
        const p = this.state.players.get(sid);
        if (p) wolves.push({ sessionId: sid, nickname: p.nickname });
      }
      client.send("wolfTeam", { wolves });
    }
  }

  private aliveCount(): number {
    let n = 0;
    for (const p of this.state.players.values()) if (p.alive) n++;
    return n;
  }

  private setPhase(
    phase: string,
    durationMs: number,
    onEnd: () => void,
  ) {
    this.clearPhaseTimer();
    this.state.phase = phase;
    this.state.phaseEndsAt = durationMs > 0 ? Date.now() + durationMs : 0;
    if (durationMs > 0) {
      this.phaseTimer = setTimeout(() => {
        this.phaseTimer = null;
        try {
          onEnd();
        } catch (e) {
          console.error("[mafia] phase end error", e);
        }
      }, durationMs);
    }
  }

  private clearPhaseTimer() {
    if (this.phaseTimer) {
      clearTimeout(this.phaseTimer);
      this.phaseTimer = null;
    }
  }

  onDispose() {
    this.clearPhaseTimer();
  }

  private pushLog(
    text: string,
    extras: Partial<{
      kind: string;
      actor: string;
      target: string;
      card: number;
      guess: number;
    }> = {},
  ) {
    const e = new LogEntry();
    e.ts = Date.now();
    e.text = text;
    e.kind = extras.kind || "info";
    e.actor = extras.actor || "";
    e.target = extras.target || "";
    e.card = extras.card || 0;
    e.guess = extras.guess || 0;
    this.state.log.push(e);
    if (this.state.log.length > 200) this.state.log.splice(0, this.state.log.length - 200);
  }
}

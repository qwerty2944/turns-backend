import type { Client } from "colyseus";
import { MafiaPlayer } from "./state.js";
import { pickMasks } from "../../common/colyseus/mask-nicknames.js";
import {
  PHASE_MS,
  ROLE,
  ROLE_NAMES_KR,
  type Role,
  checkWinner,
  rolesFor,
  shuffle,
} from "./rules.js";
import type { MafiaRoom } from "./room.js";

export type NightAction = { kind: "wolf" | "doctor" | "seer"; targetId: string };

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

/**
 * 마피아 게임 로직 (Nest 관점의 service 레이어). Room은 전송/수명주기
 * 게이트웨이로만 남고, 페이즈 머신·역할 배정·밤 행동·투표는 전부 여기서
 * 관리한다. Colyseus가 Room을 직접 인스턴스화하므로 DI 대신 room 참조를
 * 생성자로 받는다.
 */
export class MafiaService {
  private store: RoundStore = newStore();
  private phaseTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly room: MafiaRoom) {}

  private get state() {
    return this.room.state;
  }

  /** onLeave: 이탈자의 역할 조회 (사망 공개용). */
  roleOf(sessionId: string): Role | undefined {
    return this.store.roles.get(sessionId);
  }

  /** onDispose / 방 정리: 페이즈 타이머 해제. */
  dispose() {
    this.clearPhaseTimer();
  }

  aliveCount(): number {
    let n = 0;
    for (const p of this.state.players.values()) if (p.alive) n++;
    return n;
  }

  // ─── Game flow ──────────────────────────────────────────────────

  startGame() {
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
      this.room.pushLog("🎭 닉네임이 가려졌습니다", { kind: "system" });
    }

    // Tell each client their role
    for (const c of this.room.clients) {
      const role = this.store.roles.get(c.sessionId);
      if (role) c.send("role", { role });
    }
    // Tell wolves about each other
    const wolfIds = ids.filter((s) => this.store.roles.get(s) === ROLE.WOLF);
    const wolfTeam = wolfIds.map((sid) => ({
      sessionId: sid,
      nickname: this.state.players.get(sid)?.nickname ?? "",
    }));
    for (const c of this.room.clients) {
      if (this.store.roles.get(c.sessionId) === ROLE.WOLF) {
        c.send("wolfTeam", { wolves: wolfTeam });
      }
    }

    this.state.dayCount = 0;
    this.state.lastKilledId = "";
    this.state.lastLynchedId = "";
    this.state.lastNightSaved = false;
    this.state.winners = "";
    this.room.pushLog("🎴 게임 시작 — 각자 자신의 역할을 확인하세요", { kind: "system" });

    // Brief reveal beat before first night
    this.setPhase("roleReveal", PHASE_MS.roleReveal, () => this.toNight());
  }

  private toNight() {
    this.state.dayCount += 1;
    this.store.wolfPicks.clear();
    this.store.doctorPick = "";
    this.store.seerPick = "";
    for (const p of this.state.players.values()) p.voteTarget = "";
    this.room.pushLog(`🌙 ${this.state.dayCount}일째 밤이 찾아옵니다`, { kind: "system" });
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
        this.room.pushLog(`🐺 ${v.nickname} 님이 늑대에게 습격당했습니다`, {
          kind: "system",
          actor: v.nickname,
        });
      }
    } else if (saved) {
      const v = this.state.players.get(victim);
      this.room.pushLog(`✨ 조용한 밤이었습니다${v ? ` (${v.nickname} 보호됨)` : ""}`, {
        kind: "system",
      });
    } else {
      this.room.pushLog(`🤫 늑대가 행동하지 않았습니다`, { kind: "system" });
    }

    // Seer result — send privately to seer
    const seerEntry = Array.from(this.store.roles.entries()).find(
      ([, role]) => role === ROLE.SEER,
    );
    if (seerEntry && this.store.seerPick) {
      const [seerSid] = seerEntry;
      const seerClient = this.room.clients.find((c) => c.sessionId === seerSid);
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
    this.room.pushLog(`☀️ ${this.state.dayCount}일째 낮 — 토론`, { kind: "system" });
    this.setPhase("day", PHASE_MS.day, () => this.toVote());
  }

  private toVote() {
    for (const p of this.state.players.values()) p.voteTarget = "";
    this.room.pushLog(`🗳 투표 시간`, { kind: "system" });
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
        this.room.pushLog(
          `⚖️ ${v.nickname} 님이 처형되었습니다 (${ROLE_NAMES_KR[(v.revealedRole as Role)] ?? v.revealedRole})`,
          { kind: "system", actor: v.nickname },
        );
      }
    } else {
      this.state.lastLynchedId = "";
      this.room.pushLog(`🤷 동률 — 아무도 처형되지 않았습니다`, { kind: "system" });
    }

    if (this.checkGameEnd()) return;

    this.setPhase("voteReveal", PHASE_MS.voteReveal, () => this.toNight());
  }

  handleWolfChat(client: Client, msg: string) {
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
    for (const c of this.room.clients) {
      if (this.store.roles.get(c.sessionId) === ROLE.WOLF) c.send("wolfChat", payload);
    }
  }

  handleNightAction(client: Client, payload: NightAction) {
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

  handleVote(client: Client, targetId: string | null) {
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

  checkGameEnd(): boolean {
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
    this.room.pushLog(
      winner === "wolves" ? "🐺 늑대의 승리!" : "🌾 시민의 승리!",
      { kind: "result" },
    );
    this.setPhase("gameEnd", 0, () => {});
    return true;
  }

  resendPrivate(client: Client) {
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
}

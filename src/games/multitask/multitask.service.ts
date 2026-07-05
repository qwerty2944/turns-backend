import type { Client } from "colyseus";
import {
  MultitaskPlayer,
  TapTarget,
  DodgeBlock,
} from "./state.js";
import { pickMasks } from "../../common/colyseus/mask-nicknames.js";
import {
  STARTING_HEARTS,
  MATCH_MS,
  SERVER_NOW_SYNC_MS,
  DAMAGE_COOLDOWN_MS,
  TAP_MAX_ACTIVE,
  TAP_MISS_THRESHOLD,
  DODGE_HIT_Y_BAND,
  difficultyFor,
  holdCycleMs,
  pickHoldZone,
  tapInterval,
  tapLifetime,
  dodgeInterval,
  dodgeFallMs,
  pickTapCell,
  pickDodgeCol,
} from "./rules.js";
import type { MultitaskRoom } from "./room.js";

export type InputMsg =
  | { kind: "hold" }
  | { kind: "tap"; cell: number }
  | { kind: "move"; col: number };

type PerPlayer = {
  // running schedules
  nextTapSpawnAt: number;
  nextDodgeSpawnAt: number;
  lastDodgeCol: number;
  // hold cycle tracking
  holdCycleStartedAt: number;
  // id counters
  tapIdCtr: number;
  blockIdCtr: number;
};

/**
 * 멀티태스크 게임 로직 (Nest 관점의 service 레이어). Room은 전송/수명주기
 * 게이트웨이로만 남고, 매치 진행·태스크 스폰·입력 판정·데미지는 전부 여기서
 * 관리한다. Colyseus가 Room을 직접 인스턴스화하므로 DI 대신 room 참조를
 * 생성자로 받는다.
 */
export class MultitaskService {
  private per = new Map<string, PerPlayer>();
  private lastNowSync = 0;
  private matchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly room: MultitaskRoom) {}

  private get state() {
    return this.room.state;
  }

  /** onLeave: 이탈자의 스폰 스케줄/카운터 정리. */
  dropPlayer(sessionId: string) {
    this.per.delete(sessionId);
  }

  /** onDispose: 서비스가 등록한 타이머 정리. */
  dispose() {
    if (this.matchTimer) {
      clearTimeout(this.matchTimer);
      this.matchTimer = null;
    }
  }

  // ── Match lifecycle ─────────────────────────────────────────────

  startMatch() {
    const now = Date.now();
    this.state.startedAt = now;
    this.state.endsAt = now + MATCH_MS;
    this.state.difficulty = 1;
    this.state.winnerSessionId = "";
    this.state.winnerNickname = "";
    this.state.phase = "playing";

    if (this.state.maskNicknames) {
      const players = Array.from(this.state.players.values());
      const masks = pickMasks(players.length);
      players.forEach((p, i) => { p.nickname = masks[i]; });
      this.room.pushLog("🎭 닉네임이 가려졌습니다", { kind: "system" });
    }

    for (const p of this.state.players.values()) {
      p.alive = true;
      p.hearts = STARTING_HEARTS;
      p.score = 0;
      p.tapMisses = 0;
      p.lastDamageAt = 0;
      p.deathAt = 0;
      p.dodgeCol = 1;
      p.tapTargets.splice(0, p.tapTargets.length);
      p.dodgeBlocks.splice(0, p.dodgeBlocks.length);
      p.holdPos = 0;
      const [zs, ze] = pickHoldZone(1);
      p.holdZoneStart = zs;
      p.holdZoneEnd = ze;
      p.holdCycleId = 1;

      this.per.set(p.sessionId, {
        nextTapSpawnAt: now + 800,
        nextDodgeSpawnAt: now + 1200,
        lastDodgeCol: -1,
        holdCycleStartedAt: now,
        tapIdCtr: 0,
        blockIdCtr: 0,
      });
    }

    this.room.pushLog("🎯 멀티태스크 시작! 3분 안에 살아남아라", { kind: "system" });

    if (this.matchTimer) clearTimeout(this.matchTimer);
    this.matchTimer = setTimeout(() => this.endByTimeout(), MATCH_MS);
  }

  resetToLobby() {
    if (this.matchTimer) {
      clearTimeout(this.matchTimer);
      this.matchTimer = null;
    }
    this.per.clear();
    this.state.phase = "lobby";
    this.state.winnerSessionId = "";
    this.state.winnerNickname = "";
    this.state.difficulty = 1;
    for (const p of this.state.players.values()) {
      p.ready = false;
      p.alive = true;
      p.hearts = STARTING_HEARTS;
      p.score = 0;
      p.tapMisses = 0;
      p.lastDamageAt = 0;
      p.deathAt = 0;
      p.dodgeCol = 1;
      p.tapTargets.splice(0, p.tapTargets.length);
      p.dodgeBlocks.splice(0, p.dodgeBlocks.length);
      p.holdPos = 0;
      p.holdZoneStart = 0;
      p.holdZoneEnd = 0;
      p.holdCycleId = 0;
    }
    this.room.pushLog("⏪ 로비로 돌아갑니다", { kind: "system" });
  }

  private endByTimeout() {
    if (this.state.phase !== "playing") return;
    // Highest score among the still-alive set wins (ties → earliest joiner).
    const alive = Array.from(this.state.players.values()).filter((p) => p.alive);
    const pool = alive.length > 0 ? alive : Array.from(this.state.players.values());
    let winner: MultitaskPlayer | null = null;
    for (const p of pool) {
      if (!winner || p.score > winner.score) winner = p;
    }
    this.declareWinner(winner);
  }

  checkMatchEnd() {
    if (this.state.phase !== "playing") return;
    const total = this.state.players.size;
    const alive = Array.from(this.state.players.values()).filter((p) => p.alive);
    if (total <= 1) {
      // Solo: end only when the lone player dies; otherwise let the timer run.
      if (alive.length === 0) this.declareWinner(null);
      return;
    }
    if (alive.length <= 1) {
      this.declareWinner(alive[0] ?? null);
    }
  }

  private declareWinner(winner: MultitaskPlayer | null) {
    if (this.state.phase === "gameEnd") return;
    this.state.phase = "gameEnd";
    if (this.matchTimer) {
      clearTimeout(this.matchTimer);
      this.matchTimer = null;
    }
    if (winner) {
      this.state.winnerSessionId = winner.sessionId;
      this.state.winnerNickname = winner.nickname;
      this.room.pushLog(`🏆 ${winner.nickname} 님 승리! (점수 ${winner.score})`, {
        kind: "win",
        actor: winner.nickname,
      });
    } else {
      this.room.pushLog("무승부 — 모두 탈락", { kind: "system" });
    }
  }

  // ── Sim tick ────────────────────────────────────────────────────

  tick(_dt: number) {
    if (this.state.phase !== "playing") return;
    const now = Date.now();

    const elapsed = now - this.state.startedAt;
    const newDiff = difficultyFor(elapsed);
    if (newDiff !== this.state.difficulty) {
      this.state.difficulty = newDiff;
      this.room.pushLog(`⚡ 난이도 ${newDiff} — 속도 증가!`, { kind: "system" });
    }

    if (now - this.lastNowSync > SERVER_NOW_SYNC_MS) {
      this.state.serverNow = now;
      this.lastNowSync = now;
    }

    for (const p of this.state.players.values()) {
      if (!p.alive) continue;
      const ctx = this.per.get(p.sessionId);
      if (!ctx) continue;
      this.tickHold(p, ctx, now);
      this.tickTap(p, ctx, now);
      this.tickDodge(p, ctx, now);
      if (p.hearts <= 0 && p.alive) {
        p.alive = false;
        p.hearts = 0;
        p.deathAt = now;
        // Clear active tasks so the dead board is calm.
        p.tapTargets.splice(0, p.tapTargets.length);
        p.dodgeBlocks.splice(0, p.dodgeBlocks.length);
        this.room.pushLog(`💀 ${p.nickname} 님 탈락 (점수 ${p.score})`, {
          kind: "death",
          actor: p.nickname,
        });
      }
    }

    this.checkMatchEnd();
  }

  private tickHold(p: MultitaskPlayer, ctx: PerPlayer, now: number) {
    const cycleMs = holdCycleMs(this.state.difficulty);
    const elapsed = now - ctx.holdCycleStartedAt;
    if (elapsed >= cycleMs) {
      // Cycle ended without tap → miss (penalty)
      this.damage(p, now, "홀드 실패");
      ctx.holdCycleStartedAt = now;
      const [zs, ze] = pickHoldZone(this.state.difficulty);
      p.holdZoneStart = zs;
      p.holdZoneEnd = ze;
      p.holdCycleId++;
      p.holdPos = 0;
      return;
    }
    p.holdPos = Math.min(1, elapsed / cycleMs);
  }

  private tickTap(p: MultitaskPlayer, ctx: PerPlayer, now: number) {
    // Remove expired targets and count misses
    for (let i = p.tapTargets.length - 1; i >= 0; i--) {
      const t = p.tapTargets[i];
      if (now >= t.expiresAt) {
        p.tapTargets.splice(i, 1);
        p.tapMisses += 1;
        if (p.tapMisses >= TAP_MISS_THRESHOLD) {
          p.tapMisses = 0;
          this.damage(p, now, "탭 미스 3연속");
        }
      }
    }
    if (now < ctx.nextTapSpawnAt) return;
    if (p.tapTargets.length >= TAP_MAX_ACTIVE) {
      ctx.nextTapSpawnAt = now + 200;
      return;
    }
    const occupied = new Set<number>();
    for (const t of p.tapTargets) occupied.add(t.cell);
    const cell = pickTapCell(occupied);
    if (cell < 0) {
      ctx.nextTapSpawnAt = now + 200;
      return;
    }
    const tt = new TapTarget();
    tt.id = ++ctx.tapIdCtr;
    tt.cell = cell;
    tt.spawnedAt = now;
    tt.expiresAt = now + tapLifetime(this.state.difficulty);
    p.tapTargets.push(tt);
    ctx.nextTapSpawnAt = now + tapInterval(this.state.difficulty);
  }

  private tickDodge(p: MultitaskPlayer, ctx: PerPlayer, now: number) {
    // Update positions, detect collisions, drop blocks that fell off.
    const [hitTop, hitBot] = DODGE_HIT_Y_BAND;
    for (let i = p.dodgeBlocks.length - 1; i >= 0; i--) {
      const b = p.dodgeBlocks[i];
      const age = now - b.spawnedAt;
      b.y = Math.min(1.1, age * b.speed);
      if (b.y >= hitTop && b.y <= hitBot && b.col === p.dodgeCol) {
        // Collision — apply damage with cooldown, then remove block so it doesn't re-trigger.
        this.damage(p, now, "회피 실패");
        p.dodgeBlocks.splice(i, 1);
        continue;
      }
      if (b.y > 1.05) {
        p.dodgeBlocks.splice(i, 1);
        // Successfully dodged → small score bump (encourages staying alive).
        p.score += 1;
      }
    }
    if (now < ctx.nextDodgeSpawnAt) return;
    const fall = dodgeFallMs(this.state.difficulty);
    const block = new DodgeBlock();
    block.id = ++ctx.blockIdCtr;
    block.col = pickDodgeCol(ctx.lastDodgeCol);
    block.y = 0;
    block.speed = 1 / fall;
    block.spawnedAt = now;
    ctx.lastDodgeCol = block.col;
    p.dodgeBlocks.push(block);
    ctx.nextDodgeSpawnAt = now + dodgeInterval(this.state.difficulty);
  }

  // ── Input handling ──────────────────────────────────────────────

  handleInput(client: Client, msg: InputMsg) {
    if (this.state.phase !== "playing") return;
    const p = this.state.players.get(client.sessionId);
    if (!p || !p.alive) return;
    const ctx = this.per.get(client.sessionId);
    if (!ctx) return;
    const now = Date.now();

    if (msg.kind === "hold") {
      // Judge whether indicator is currently in zone.
      if (p.holdPos >= p.holdZoneStart && p.holdPos <= p.holdZoneEnd) {
        // Bonus scales with zone tightness (smaller zone = harder = more score).
        const w = Math.max(0.01, p.holdZoneEnd - p.holdZoneStart);
        p.score += Math.round(5 + (1 - w) * 15);
      } else {
        this.damage(p, now, "홀드 빗나감");
      }
      // Whether hit or miss, that cycle is consumed — start a new one.
      ctx.holdCycleStartedAt = now;
      const [zs, ze] = pickHoldZone(this.state.difficulty);
      p.holdZoneStart = zs;
      p.holdZoneEnd = ze;
      p.holdCycleId++;
      p.holdPos = 0;
      return;
    }

    if (msg.kind === "tap") {
      const cell = msg.cell | 0;
      if (cell < 0 || cell > 15) return;
      for (let i = 0; i < p.tapTargets.length; i++) {
        const t = p.tapTargets[i];
        if (t.cell === cell) {
          p.tapTargets.splice(i, 1);
          p.tapMisses = 0;
          p.score += 3;
          return;
        }
      }
      // Mis-click on empty cell — minor score nudge backward to discourage spam.
      p.score = Math.max(0, p.score - 1);
      return;
    }

    if (msg.kind === "move") {
      const col = msg.col | 0;
      if (col < 0 || col > 2) return;
      p.dodgeCol = col;
      return;
    }
  }

  private damage(p: MultitaskPlayer, now: number, reason: string) {
    if (now - p.lastDamageAt < DAMAGE_COOLDOWN_MS) return;
    p.lastDamageAt = now;
    p.hearts = Math.max(0, p.hearts - 1);
    this.room.pushLog(`💥 ${p.nickname} -1 (${reason}) — 하트 ${p.hearts}`, {
      kind: "hit",
      actor: p.nickname,
    });
  }
}

import { Room, Client, CloseCode } from "colyseus";
import { ArraySchema } from "@colyseus/schema";
import {
  TetrisState,
  PlayerBoard,
  FallingPiece,
  LogEntry,
  BOARD_W,
  BOARD_H,
  BOARD_CELLS,
} from "./state.js";
import {
  MIN_PLAYERS,
  MAX_PLAYERS,
  GARBAGE_CELL,
  LOCK_DELAY_MS,
  LOCK_MAX_RESETS,
  SPAWN_X,
  SPAWN_Y,
  canPlace,
  gravityMsForLevel,
  idx,
  kicksFor,
  linesToGarbage,
  occupiedCells,
  PIECE,
  scoreForClear,
  shuffle7Bag,
} from "./rules.js";
import { verifyAuthRequest } from "../../shared/auth/middleware.js";
import { Spectator, isSpectator } from "../../shared/colyseus/spectator.js";
import { pickMasks } from "../../shared/colyseus/mask-nicknames.js";

type JoinOptions = {
  token?: string;
  roomName?: string;
  maxPlayers?: number;
  maskNicknames?: boolean;
};

type InputAction =
  | "left"
  | "right"
  | "softDrop"
  | "hardDrop"
  | "rotateCW"
  | "rotateCCW"
  | "hold";

type RuntimeState = {
  // Per-player private runtime data (never on Schema)
  bag: number[];
  lastFallAt: number;     // ms timestamp of last gravity step
  touchingSince: number;  // ms when piece first touched ground (0 = airborne)
  lockResets: number;     // input-induced lock delay resets so far this piece
};

export class TetrisRoom extends Room {
  state = new TetrisState();
  maxClients = MAX_PLAYERS;
  autoDispose = true;
  seatReservationTimeout = 15;

  private runtime: Map<string, RuntimeState> = new Map();
  private tickHandle: any = null;

  onCreate(options: JoinOptions) {
    this.state.roomName = (options.roomName || "Room").slice(0, 24);
    this.state.maxPlayers = Math.min(
      MAX_PLAYERS,
      Math.max(MIN_PLAYERS, options.maxPlayers || MAX_PLAYERS),
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
      this.startNewGame();
    });

    this.onMessage("input", (client, payload: { action: InputAction }) => {
      if (isSpectator(client)) return;
      this.handleInput(client, payload?.action);
    });

    this.onMessage("nextRound", (client) => {
      if (isSpectator(client)) return;
      if (client.sessionId !== this.state.hostSessionId) return;
      if (this.state.phase !== "roundEnd") return;
      this.startRound();
    });

    this.onMessage("chat", (client, msg: string) => {
      if (isSpectator(client)) return;
      const p = this.state.players.get(client.sessionId);
      if (!p || typeof msg !== "string") return;
      this.pushLog(`💬 ${p.nickname}: ${msg.slice(0, 120)}`, {
        kind: "info",
        actor: p.nickname,
      });
    });

    // 33ms tick — fine-grained enough for gravity at all levels.
    this.tickHandle = this.clock.setInterval(() => this.tickAll(), 33);
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
    const board = new PlayerBoard();
    board.sessionId = client.sessionId;
    board.userId = auth.userId;
    board.nickname = auth.nickname;
    board.cells = makeEmptyCells();
    this.state.players.set(client.sessionId, board);
    this.state.seatOrder.push(client.sessionId);

    if (!this.state.hostSessionId) {
      this.state.hostSessionId = client.sessionId;
    }
    this.pushLog(`${board.nickname} 님 입장`, {
      kind: "system",
      actor: board.nickname,
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
      this.removeSeat(client.sessionId);
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
    } catch {
      if (p.alive) {
        p.alive = false;
        this.pushLog(`${p.nickname} 님 연결 끊김 - 라운드 탈락`, {
          kind: "system",
          actor: p.nickname,
        });
      }
      this.removeSeat(client.sessionId);
      this.checkRoundEnd();
      this.disposeIfBelowMin();
    }
  }

  onDispose() {
    if (this.tickHandle) this.tickHandle.clear?.();
    this.tickHandle = null;
  }

  private removeSeat(sid: string) {
    this.state.players.delete(sid);
    this.runtime.delete(sid);
    const i = this.state.seatOrder.indexOf(sid);
    if (i >= 0) this.state.seatOrder.splice(i, 1);
    if (this.state.hostSessionId === sid) {
      this.state.hostSessionId = this.state.seatOrder[0] ?? "";
    }
  }

  private disposeIfBelowMin() {
    if (this.state.players.size === 0) {
      this.disconnect().catch(() => {});
      return;
    }
    if (this.state.phase !== "lobby" && this.state.players.size < MIN_PLAYERS) {
      this.pushLog(`👋 인원 부족으로 방이 종료됩니다`, { kind: "system" });
      this.clock.setTimeout(() => this.disconnect().catch(() => {}), 600);
    }
  }

  // ───────── Game flow ───────── //

  private startNewGame() {
    for (const p of this.state.players.values()) p.tokens = 0;
    this.state.lastWinnerId = "";
    if (this.state.maskNicknames) {
      const players = Array.from(this.state.players.values());
      const masks = pickMasks(players.length);
      players.forEach((p, i) => { p.nickname = masks[i]; });
      this.pushLog("🎭 닉네임이 가려졌습니다", { kind: "system" });
    }
    this.startRound();
  }

  private startRound() {
    this.state.roundWinnerId = "";
    this.state.gameWinnerId = "";
    this.state.phase = "playing";
    this.runtime.clear();
    const now = Date.now();

    for (const [sid, p] of this.state.players.entries()) {
      p.cells = makeEmptyCells();
      p.hold = 0;
      p.holdUsed = false;
      p.level = 1;
      p.lines = 0;
      p.score = 0;
      p.incomingGarbage = 0;
      p.alive = true;
      p.nextQueue = new ArraySchema<number>();
      p.cur = new FallingPiece();

      const rs: RuntimeState = {
        bag: shuffle7Bag(),
        lastFallAt: now,
        touchingSince: 0,
        lockResets: 0,
      };
      this.runtime.set(sid, rs);
      this.refillQueue(p, rs);
      this.spawnNext(p, rs);
    }

    this.pushLog(`🟦 새 라운드 시작 — ${this.state.players.size}명`, {
      kind: "system",
    });
  }

  private refillQueue(board: PlayerBoard, rs: RuntimeState) {
    while (board.nextQueue.length < 5) {
      if (rs.bag.length === 0) rs.bag = shuffle7Bag();
      board.nextQueue.push(rs.bag.shift()!);
    }
  }

  private spawnNext(board: PlayerBoard, rs: RuntimeState) {
    // Apply pending garbage BEFORE the new piece spawns.
    if (board.incomingGarbage > 0) {
      this.applyIncomingGarbage(board);
    }
    this.refillQueue(board, rs);
    const type = board.nextQueue.shift() ?? 1;
    this.refillQueue(board, rs);

    board.cur.type = type;
    board.cur.rot = 0;
    board.cur.x = SPAWN_X;
    board.cur.y = SPAWN_Y;
    board.holdUsed = false;
    rs.touchingSince = 0;
    rs.lockResets = 0;
    rs.lastFallAt = Date.now();

    const cells = cellArrayOf(board);
    if (!canPlace(cells, type, 0, SPAWN_X, SPAWN_Y)) {
      // Top-out: tried to spawn on top of existing blocks.
      this.eliminate(board, "탑아웃");
    }
  }

  // ───────── Input ───────── //

  private handleInput(client: Client, action: InputAction | undefined) {
    if (!action) return;
    if (this.state.phase !== "playing") return;
    const sid = client.sessionId;
    const board = this.state.players.get(sid);
    if (!board || !board.alive) return;
    const rs = this.runtime.get(sid);
    if (!rs || !board.cur.type) return;
    const cells = cellArrayOf(board);

    switch (action) {
      case "left":
        if (canPlace(cells, board.cur.type, board.cur.rot, board.cur.x - 1, board.cur.y)) {
          board.cur.x -= 1;
          this.bumpLockReset(rs, board, cells);
        }
        break;
      case "right":
        if (canPlace(cells, board.cur.type, board.cur.rot, board.cur.x + 1, board.cur.y)) {
          board.cur.x += 1;
          this.bumpLockReset(rs, board, cells);
        }
        break;
      case "softDrop":
        if (canPlace(cells, board.cur.type, board.cur.rot, board.cur.x, board.cur.y + 1)) {
          board.cur.y += 1;
          board.score += 1;
          rs.lastFallAt = Date.now();
          rs.touchingSince = 0;
        }
        break;
      case "hardDrop": {
        let drop = 0;
        while (canPlace(cells, board.cur.type, board.cur.rot, board.cur.x, board.cur.y + 1)) {
          board.cur.y += 1;
          drop += 1;
        }
        board.score += drop * 2;
        this.lockPiece(board, rs);
        break;
      }
      case "rotateCW":
        this.tryRotate(board, rs, +1);
        break;
      case "rotateCCW":
        this.tryRotate(board, rs, -1);
        break;
      case "hold":
        this.tryHold(board, rs);
        break;
    }
  }

  private tryRotate(board: PlayerBoard, rs: RuntimeState, dir: 1 | -1) {
    const from = board.cur.rot & 3;
    const to = ((from + (dir === 1 ? 1 : 3)) & 3);
    const kicks = kicksFor(board.cur.type)[`${from}->${to}`] ?? [[0, 0]];
    const cells = cellArrayOf(board);
    for (const [dx, dy] of kicks) {
      const nx = board.cur.x + dx;
      const ny = board.cur.y - dy; // SRS uses Y-up; our board is Y-down, flip sign.
      if (canPlace(cells, board.cur.type, to, nx, ny)) {
        board.cur.x = nx;
        board.cur.y = ny;
        board.cur.rot = to;
        this.bumpLockReset(rs, board, cells);
        return;
      }
    }
  }

  private tryHold(board: PlayerBoard, rs: RuntimeState) {
    if (board.holdUsed) return;
    const swapping = board.hold;
    const current = board.cur.type;
    board.hold = current;
    board.holdUsed = true;
    if (swapping) {
      board.cur.type = swapping;
    } else {
      this.refillQueue(board, rs);
      board.cur.type = board.nextQueue.shift() ?? 1;
      this.refillQueue(board, rs);
    }
    board.cur.rot = 0;
    board.cur.x = SPAWN_X;
    board.cur.y = SPAWN_Y;
    rs.touchingSince = 0;
    rs.lockResets = 0;
    rs.lastFallAt = Date.now();
    const cells = cellArrayOf(board);
    if (!canPlace(cells, board.cur.type, 0, SPAWN_X, SPAWN_Y)) {
      this.eliminate(board, "탑아웃");
    }
  }

  private bumpLockReset(rs: RuntimeState, board: PlayerBoard, cells: number[]) {
    if (rs.touchingSince === 0) return;
    if (rs.lockResets >= LOCK_MAX_RESETS) return;
    // Only reset if piece is still touching ground after the input.
    const stillTouching = !canPlace(cells, board.cur.type, board.cur.rot, board.cur.x, board.cur.y + 1);
    if (stillTouching) {
      rs.touchingSince = Date.now();
      rs.lockResets += 1;
    } else {
      rs.touchingSince = 0;
    }
  }

  // ───────── Tick ───────── //

  private tickAll() {
    if (this.state.phase !== "playing") return;
    const now = Date.now();
    for (const [sid, board] of this.state.players.entries()) {
      if (!board.alive || !board.cur.type) continue;
      const rs = this.runtime.get(sid);
      if (!rs) continue;
      const cells = cellArrayOf(board);

      const canFall = canPlace(
        cells,
        board.cur.type,
        board.cur.rot,
        board.cur.x,
        board.cur.y + 1,
      );

      if (canFall) {
        const grav = gravityMsForLevel(board.level);
        if (now - rs.lastFallAt >= grav) {
          board.cur.y += 1;
          rs.lastFallAt = now;
        }
        rs.touchingSince = 0;
      } else {
        if (rs.touchingSince === 0) rs.touchingSince = now;
        if (now - rs.touchingSince >= LOCK_DELAY_MS) {
          this.lockPiece(board, rs);
        }
      }
    }
  }

  // ───────── Lock / clear / garbage ───────── //

  private lockPiece(board: PlayerBoard, rs: RuntimeState) {
    const occ = occupiedCells(board.cur.type, board.cur.rot, board.cur.x, board.cur.y);
    for (const [cx, cy] of occ) {
      if (cy < 0 || cy >= BOARD_H || cx < 0 || cx >= BOARD_W) continue;
      board.cells[idx(cx, cy)] = board.cur.type;
    }

    const cleared = this.clearLines(board);
    if (cleared.count > 0) {
      board.lines += cleared.count;
      board.score += scoreForClear(cleared.count, board.level);
      board.level = Math.max(1, Math.floor(board.lines / 10) + 1);
      board.lastClearTs = Date.now();

      const attack = linesToGarbage(cleared.count);
      const aliveOthers = Array.from(this.state.players.values()).filter(
        (p) => p.alive && p.sessionId !== board.sessionId,
      );
      // Distribute as evenly as we can.
      if (attack > 0 && aliveOthers.length > 0) {
        const per = Math.floor(attack / aliveOthers.length);
        let extra = attack % aliveOthers.length;
        for (const op of aliveOthers) {
          const add = per + (extra > 0 ? 1 : 0);
          if (extra > 0) extra -= 1;
          if (add > 0) op.incomingGarbage += add;
        }
      }

      // Send effect message — broadcast so every client sees who cleared what,
      // but include `boardSid` so they can anchor the flash to the right board.
      this.broadcast("lineCleared", {
        boardSid: board.sessionId,
        rows: cleared.rows,
        count: cleared.count,
        attack,
        attackTargets: aliveOthers.map((p) => p.sessionId),
        ts: board.lastClearTs,
      });
      this.pushLog(
        `🟧 ${board.nickname} ${cleared.count}줄 클리어${attack > 0 ? ` → ${attack} 가비지` : ""}`,
        { kind: cleared.count >= 4 ? "result" : "play", actor: board.nickname },
      );
    }

    this.spawnNext(board, rs);
  }

  private clearLines(board: PlayerBoard): { rows: number[]; count: number } {
    const rows: number[] = [];
    for (let y = 0; y < BOARD_H; y++) {
      let full = true;
      for (let x = 0; x < BOARD_W; x++) {
        if (!board.cells[idx(x, y)]) {
          full = false;
          break;
        }
      }
      if (full) rows.push(y);
    }
    if (rows.length === 0) return { rows, count: 0 };

    const next = new Array<number>(BOARD_CELLS).fill(0);
    let writeY = BOARD_H - 1;
    for (let y = BOARD_H - 1; y >= 0; y--) {
      if (rows.includes(y)) continue;
      for (let x = 0; x < BOARD_W; x++) {
        next[writeY * BOARD_W + x] = board.cells[idx(x, y)];
      }
      writeY -= 1;
    }
    board.cells = new ArraySchema<number>(...next);
    return { rows, count: rows.length };
  }

  private applyIncomingGarbage(board: PlayerBoard) {
    const n = Math.min(board.incomingGarbage, BOARD_H);
    if (n <= 0) return;
    const hole = Math.floor(Math.random() * BOARD_W);
    const cells = cellArrayOf(board);
    // Shift everything up by `n` rows. Top `n` rows fall off the top — if any
    // of those rows had blocks, the player tops out on next spawn anyway.
    const next = new Array<number>(BOARD_CELLS).fill(0);
    for (let y = n; y < BOARD_H; y++) {
      for (let x = 0; x < BOARD_W; x++) {
        next[(y - n) * BOARD_W + x] = cells[idx(x, y)];
      }
    }
    for (let g = 0; g < n; g++) {
      const y = BOARD_H - 1 - g;
      for (let x = 0; x < BOARD_W; x++) {
        next[y * BOARD_W + x] = x === hole ? 0 : GARBAGE_CELL;
      }
    }
    board.cells = new ArraySchema<number>(...next);
    board.incomingGarbage = 0;
  }

  // ───────── Elimination / round end ───────── //

  private eliminate(board: PlayerBoard, reason: string) {
    if (!board.alive) return;
    board.alive = false;
    board.cur.type = 0;
    this.pushLog(`💀 ${board.nickname} 탈락 — ${reason}`, {
      kind: "result",
      actor: board.nickname,
    });
    this.broadcast("topOut", { boardSid: board.sessionId });
    this.checkRoundEnd();
  }

  private checkRoundEnd(): boolean {
    if (this.state.phase !== "playing") return false;
    const alive = Array.from(this.state.players.values()).filter((p) => p.alive);
    if (alive.length > 1) return false;
    const winner = alive[0];
    this.finishRound(winner);
    return true;
  }

  private finishRound(winner: PlayerBoard | undefined) {
    if (winner) {
      winner.tokens += 1;
      this.state.roundWinnerId = winner.sessionId;
      this.state.lastWinnerId = winner.sessionId;
      this.pushLog(`🏆 라운드 승리: ${winner.nickname} (총 ${winner.tokens}점)`, {
        kind: "result",
        actor: winner.nickname,
      });
      this.broadcast("roundWin", { boardSid: winner.sessionId });
      if (winner.tokens >= this.state.tokensToWin) {
        this.state.gameWinnerId = winner.sessionId;
        this.state.phase = "gameEnd";
        this.pushLog(`🎉 게임 승리: ${winner.nickname}!`, {
          kind: "result",
          actor: winner.nickname,
        });
        return;
      }
    }
    this.state.phase = "roundEnd";
  }

  private pushLog(
    text: string,
    extras: Partial<{
      kind: string;
      actor: string;
      target: string;
    }> = {},
  ) {
    const e = new LogEntry();
    e.ts = Date.now();
    e.text = text;
    e.kind = extras.kind ?? "info";
    e.actor = extras.actor ?? "";
    e.target = extras.target ?? "";
    this.state.log.push(e);
    if (this.state.log.length > 200) this.state.log.shift();
  }
}

// ───────── helpers ───────── //

function makeEmptyCells(): ArraySchema<number> {
  const a = new ArraySchema<number>();
  for (let i = 0; i < BOARD_CELLS; i++) a.push(0);
  return a;
}

function cellArrayOf(board: PlayerBoard): number[] {
  // ArraySchema is index-accessible like an array; copy into a plain array to
  // make `canPlace` cheap and avoid mutation surprises.
  const out = new Array<number>(BOARD_CELLS);
  for (let i = 0; i < BOARD_CELLS; i++) out[i] = board.cells[i] ?? 0;
  return out;
}

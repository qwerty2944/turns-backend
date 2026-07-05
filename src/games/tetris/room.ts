import { Room, Client, CloseCode } from "colyseus";
import { TetrisState, PlayerBoard, LogEntry } from "./state.js";
import { MIN_PLAYERS, MAX_PLAYERS } from "./rules.js";
import { verifyAuthRequest } from "../../auth/token-verify.js";
import { Spectator, isSpectator } from "../../common/colyseus/spectator.js";
import {
  TetrisService,
  makeEmptyCells,
  type InputAction,
} from "./tetris.service.js";

type JoinOptions = {
  token?: string;
  roomName?: string;
  maxPlayers?: number;
  maskNicknames?: boolean;
};

/**
 * 전송/수명주기 게이트웨이 (Nest 관점의 controller/gateway 역할):
 * 인증·입퇴장·메시지 라우팅만 담당하고, 게임 규칙은 전부
 * TetrisService에 위임한다.
 */
export class TetrisRoom extends Room {
  state = new TetrisState();
  maxClients = MAX_PLAYERS;
  autoDispose = true;
  seatReservationTimeout = 15;
  private readonly service = new TetrisService(this);

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
      this.service.startNewGame();
    });

    this.onMessage("input", (client, payload: { action: InputAction }) => {
      if (isSpectator(client)) return;
      this.service.handleInput(client, payload?.action);
    });

    this.onMessage("nextRound", (client) => {
      if (isSpectator(client)) return;
      if (client.sessionId !== this.state.hostSessionId) return;
      if (this.state.phase !== "roundEnd") return;
      this.service.startRound();
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
    this.tickHandle = this.clock.setInterval(() => this.service.tickAll(), 33);
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
      this.service.checkRoundEnd();
      this.disposeIfBelowMin();
    }
  }

  onDispose() {
    if (this.tickHandle) this.tickHandle.clear?.();
    this.tickHandle = null;
  }

  private removeSeat(sid: string) {
    this.state.players.delete(sid);
    this.service.dropPlayer(sid);
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

  pushLog(
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

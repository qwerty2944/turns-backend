import { Room, Client, CloseCode } from "colyseus";
import { MafiaState, MafiaPlayer, LogEntry } from "./state.js";
import { verifyAuthRequest } from "../../auth/token-verify.js";
import { Spectator, isSpectator } from "../../common/colyseus/spectator.js";
import { MIN_PLAYERS, MAX_PLAYERS } from "./rules.js";
import { MafiaService, type NightAction } from "./mafia.service.js";

type JoinOptions = {
  token?: string;
  roomName?: string;
  maxPlayers?: number;
  maskNicknames?: boolean;
};

/**
 * 전송/수명주기 게이트웨이 (Nest 관점의 controller/gateway 역할):
 * 인증·입퇴장·메시지 라우팅만 담당하고, 게임 규칙은 전부
 * MafiaService에 위임한다.
 */
export class MafiaRoom extends Room {
  state = new MafiaState();
  maxClients = MAX_PLAYERS;
  autoDispose = true;
  seatReservationTimeout = 15;
  private readonly service = new MafiaService(this);

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
      this.service.startGame();
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
      this.service.handleWolfChat(client, msg);
    });

    this.onMessage("nightAction", (client, payload: NightAction) => {
      if (isSpectator(client)) return;
      this.service.handleNightAction(client, payload);
    });

    this.onMessage("vote", (client, payload: { targetId: string | null }) => {
      if (isSpectator(client)) return;
      this.service.handleVote(client, payload?.targetId ?? null);
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
      this.service.resendPrivate(client);
    } catch {
      if (p.alive) {
        p.alive = false;
        const role = this.service.roleOf(client.sessionId);
        if (role) p.revealedRole = role;
        this.pushLog(`${p.nickname} 님 연결 끊김 - 사망 처리`, {
          kind: "system",
          actor: p.nickname,
        });
      }
      this.state.players.delete(client.sessionId);
      this.service.checkGameEnd();
      this.disposeIfBelowMin();
    }
  }

  private disposeIfBelowMin() {
    if (this.state.players.size === 0) {
      this.service.dispose();
      this.disconnect().catch(() => {});
      return;
    }
    if (
      this.state.phase !== "lobby" &&
      this.service.aliveCount() < 2
    ) {
      this.pushLog(`👋 인원 부족으로 방이 종료됩니다`, { kind: "system" });
      this.clock.setTimeout(() => this.disconnect().catch(() => {}), 600);
    }
  }

  onDispose() {
    this.service.dispose();
  }

  pushLog(
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

import { Room, Client, CloseCode } from "colyseus";
import { YeouidoState, YeouidoPlayer, LogEntry } from "./state.js";
import { verifyAuthRequest } from "../../auth/token-verify.js";
import { Spectator, isSpectator } from "../../common/colyseus/spectator.js";
import {
  YeouidoService,
  type PlayCardPayload,
  type AttackPayload,
} from "./yeouido.service.js";

type JoinOptions = {
  token?: string;
  roomName?: string;
  spectator?: boolean;
};

const FACTION_NAMES: Record<string, string> = {
  ruling: "여당",
  opposition: "야당",
};

/**
 * 전송/수명주기 게이트웨이 (Nest 관점의 controller/gateway 역할):
 * 인증·입퇴장·메시지 라우팅만 담당하고, 게임 규칙은 전부
 * YeouidoService에 위임한다.
 */
export class YeouidoRoom extends Room {
  state = new YeouidoState();
  maxClients = 2;
  autoDispose = true;
  seatReservationTimeout = 15;
  private readonly service = new YeouidoService(this);

  onCreate(options: JoinOptions) {
    this.state.roomName = (options.roomName || "Room").slice(0, 24);
    this.setMetadata({ roomName: this.state.roomName });

    this.onMessage("pickFaction", (client, payload: { faction?: string }) => {
      if (isSpectator(client)) return;
      const p = this.state.players.get(client.sessionId);
      if (!p || this.state.phase !== "lobby") return;
      const faction = payload?.faction;
      if (faction !== "ruling" && faction !== "opposition") return;
      // 선점제 — 상대가 이미 든 진영은 선택 불가
      for (const other of this.state.players.values()) {
        if (other.sessionId !== client.sessionId && other.faction === faction) return;
      }
      p.faction = faction;
      this.pushLog(`${p.nickname} — ${FACTION_NAMES[faction]} 후보 선택`, {
        kind: "system",
        actor: p.nickname,
      });
    });

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
      if (this.state.players.size !== 2) return;
      const players = Array.from(this.state.players.values());
      if (players.some((p) => !p.faction)) return;
      const allReady = players.every(
        (p) => p.ready || p.sessionId === this.state.hostSessionId,
      );
      if (!allReady) return;
      this.service.startGame();
    });

    // 게임 액션은 방어적으로 감싼다 — 예외가 프로세스 전체를 죽이지 않도록.
    this.onMessage("playCard", (client, payload: PlayCardPayload) => {
      if (isSpectator(client)) return;
      try {
        this.service.handlePlayCard(client, payload || {});
      } catch (e) {
        console.error("[yeouido] playCard error", e);
      }
    });

    this.onMessage("attack", (client, payload: AttackPayload) => {
      if (isSpectator(client)) return;
      try {
        this.service.handleAttack(client, payload || {});
      } catch (e) {
        console.error("[yeouido] attack error", e);
      }
    });

    this.onMessage("heroPower", (client) => {
      if (isSpectator(client)) return;
      try {
        this.service.handleHeroPower(client);
      } catch (e) {
        console.error("[yeouido] heroPower error", e);
      }
    });

    this.onMessage("endTurn", (client) => {
      if (isSpectator(client)) return;
      if (this.state.phase !== "playing") return;
      if (client.sessionId !== this.state.turnSid) return;
      this.service.doEndTurn();
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
  }

  async onAuth(_client: Client, options: JoinOptions) {
    if (!options.token) throw new Error("토큰 없음");
    const payload = await verifyAuthRequest(options.token);
    if (!payload) {
      throw new Error("다른 브라우저에서 로그인되었거나 토큰이 만료되었습니다");
    }
    return payload;
  }

  onJoin(client: Client, options: JoinOptions, auth: any) {
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
    const player = new YeouidoPlayer();
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
      this.pushLog(`${p.nickname} 님 퇴장`, { kind: "system", actor: p.nickname });
      this.disposeIfEmpty();
      return;
    }

    if (this.state.phase === "gameEnd") {
      this.state.players.delete(client.sessionId);
      this.disposeIfEmpty();
      return;
    }

    // playing — allow reconnection; failure = 기권패
    try {
      if (consented) throw new Error("consented leave");
      await this.allowReconnection(client, 30);
      p.connected = true;
      this.pushLog(`${p.nickname} 님 재접속`, { kind: "system", actor: p.nickname });
    } catch {
      if (this.state.phase === "playing") {
        this.pushLog(`${p.nickname} 님 이탈 — 기권패 처리`, {
          kind: "system",
          actor: p.nickname,
        });
        this.service.forfeit(client.sessionId);
      }
      this.state.players.delete(client.sessionId);
      this.service.dropPlayer(client.sessionId);
      this.disposeIfEmpty();
    }
  }

  onDispose() {
    this.service.clearTurnTimer();
  }

  private disposeIfEmpty() {
    if (this.state.players.size === 0) {
      this.service.clearTurnTimer();
      this.disconnect().catch(() => {});
      return;
    }
    if (this.state.phase !== "lobby" && this.state.players.size < 2 && this.state.phase !== "gameEnd") {
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
      card: string;
    }> = {},
  ) {
    const e = new LogEntry();
    e.ts = Date.now();
    e.text = text;
    e.kind = extras.kind ?? "info";
    e.actor = extras.actor ?? "";
    e.target = extras.target ?? "";
    e.card = extras.card ?? "";
    this.state.log.push(e);
    if (this.state.log.length > 200) this.state.log.shift();
  }
}

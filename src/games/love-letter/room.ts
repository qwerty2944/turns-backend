import { Room, Client, CloseCode } from "colyseus";
import { ArraySchema } from "@colyseus/schema";
import { LoveLetterState, Player, LogEntry } from "./state.js";
import { verifyAuthRequest } from "../../shared/auth/middleware.js";
import { Spectator, isSpectator } from "../../shared/colyseus/spectator.js";
import { pickMasks } from "../../shared/colyseus/mask-nicknames.js";
import {
  CARD,
  CARD_NAMES_KR,
  DECK,
  cardNeedsTarget,
  shuffle,
} from "./rules.js";

type JoinOptions = {
  token?: string;
  roomName?: string;
  maxPlayers?: number;
  maskNicknames?: boolean;
};

type PlayPayload = {
  card: number;
  targetSessionId?: string;
  guardGuess?: number;
};

type DeckStore = {
  deck: number[];
  burned: number;
  privateHands: Map<string, number[]>;
};

export class LoveLetterRoom extends Room {
  state = new LoveLetterState();
  maxClients = 4;
  autoDispose = true;
  // If a creator never actually joins (closed tab right after create),
  // drop the reservation fast instead of leaving a ghost room around.
  seatReservationTimeout = 15;
  private store: DeckStore = { deck: [], burned: -1, privateHands: new Map() };

  onCreate(options: JoinOptions) {
    this.state.roomName = (options.roomName || "Room").slice(0, 24);
    this.state.maxPlayers = Math.min(4, Math.max(2, options.maxPlayers || 4));
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
      if (this.state.players.size < 2) return;
      const allReady = Array.from(this.state.players.values()).every(
        (p) => p.ready || p.sessionId === this.state.hostSessionId,
      );
      if (!allReady) return;
      this.startNewGame();
    });

    this.onMessage("playCard", (client, payload: PlayPayload) => {
      if (isSpectator(client)) return;
      this.handlePlayCard(client, payload);
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
    const player = new Player();
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
    } catch {
      if (!p.eliminated) {
        p.eliminated = true;
        this.pushLog(`${p.nickname} 님 연결 끊김 - 라운드 탈락`, {
          kind: "system",
          actor: p.nickname,
        });
      }
      this.state.players.delete(client.sessionId);
      this.store.privateHands.delete(client.sessionId);
      const idx = this.state.turnOrder.indexOf(client.sessionId);
      if (idx >= 0) this.state.turnOrder.splice(idx, 1);
      this.checkRoundEnd();
      this.disposeIfBelowMin();
    }
  }

  private disposeIfBelowMin() {
    // Empty room — drop it regardless of phase.
    if (this.state.players.size === 0) {
      this.disconnect().catch(() => {});
      return;
    }
    // Game already started but no longer enough players to continue:
    // 러브레터는 최소 2명. 1명 남았으면 라운드/게임 자체가 무의미하므로 방 폭파.
    const MIN_PLAYERS = 2;
    if (this.state.phase !== "lobby" && this.state.players.size < MIN_PLAYERS) {
      this.pushLog(`👋 인원 부족으로 방이 종료됩니다`, { kind: "system" });
      // Slight delay so clients see the final log line before the socket closes.
      this.clock.setTimeout(() => this.disconnect().catch(() => {}), 600);
    }
  }

  // ---------- Game flow ----------

  private startNewGame() {
    for (const p of this.state.players.values()) p.tokens = 0;
    this.state.lastWinnerId = "";
    this.applyMasksIfEnabled();
    this.startRound();
  }

  private applyMasksIfEnabled() {
    if (!this.state.maskNicknames) return;
    const players = Array.from(this.state.players.values());
    const masks = pickMasks(players.length);
    for (let i = 0; i < players.length; i++) {
      players[i].nickname = masks[i];
    }
    this.pushLog("🎭 닉네임이 가려졌습니다", { kind: "system" });
  }

  private startRound() {
    const ids = Array.from(this.state.players.keys());
    this.state.turnOrder = new ArraySchema<string>(...ids);

    for (const p of this.state.players.values()) {
      p.hand = new ArraySchema<number>();
      p.discard = new ArraySchema<number>();
      p.protected = false;
      p.eliminated = false;
    }
    this.state.publicDiscard = new ArraySchema<number>();
    this.state.pendingAction = "";
    this.state.roundWinnerId = "";
    this.state.gameWinnerId = "";

    const deck = shuffle(DECK);
    this.store.burned = deck.shift()!;
    this.store.deck = deck;
    this.store.privateHands.clear();

    for (const id of ids) {
      const card = this.store.deck.shift()!;
      this.store.privateHands.set(id, [card]);
    }

    const startId =
      this.state.lastWinnerId && ids.includes(this.state.lastWinnerId)
        ? this.state.lastWinnerId
        : ids[0];
    this.state.turnIndex = ids.indexOf(startId);
    this.state.phase = "playing";
    this.pushLog(
      `🃏 새 라운드 시작 — ${ids.length}명, 시작: ${
        this.state.players.get(startId)?.nickname ?? ""
      }`,
      { kind: "system" },
    );
    this.syncHands();
    this.syncDeck();
    this.beginTurn();
  }

  private beginTurn() {
    const id = this.state.turnOrder[this.state.turnIndex];
    const p = this.state.players.get(id);
    if (!p) return;
    p.protected = false;
    if (this.store.deck.length === 0) {
      this.endRoundByDeckEmpty();
      return;
    }
    const drawn = this.store.deck.shift()!;
    const hand = this.store.privateHands.get(id) || [];
    hand.push(drawn);
    this.store.privateHands.set(id, hand);
    this.syncHands();
    this.syncDeck();
    this.pushLog(`▶ ${p.nickname} 차례 시작 — 카드를 뽑았습니다`, {
      kind: "turn",
      actor: p.nickname,
    });
  }

  private handlePlayCard(client: Client, payload: PlayPayload) {
    if (this.state.phase !== "playing") return;
    const sid = client.sessionId;
    if (sid !== this.state.turnOrder[this.state.turnIndex]) return;
    const p = this.state.players.get(sid);
    if (!p || p.eliminated) return;

    const hand = this.store.privateHands.get(sid) || [];
    const cardIdx = hand.indexOf(payload.card);
    if (cardIdx < 0) return;

    if (
      hand.includes(CARD.COUNTESS) &&
      (hand.includes(CARD.KING) || hand.includes(CARD.PRINCE)) &&
      payload.card !== CARD.COUNTESS
    ) {
      return;
    }

    hand.splice(cardIdx, 1);
    this.store.privateHands.set(sid, hand);
    p.discard.push(payload.card);
    this.state.publicDiscard.push(payload.card);

    let target: Player | undefined;
    if (cardNeedsTarget(payload.card) && payload.card !== CARD.PRINCE) {
      if (!payload.targetSessionId) {
        if (this.allOthersProtectedOrEliminated(sid)) {
          this.pushLog(
            `${p.nickname} - ${CARD_NAMES_KR[payload.card]} (대상 없음)`,
            { kind: "play", actor: p.nickname, card: payload.card },
          );
          this.advanceTurn();
          return;
        }
        hand.push(payload.card);
        p.discard.pop();
        this.state.publicDiscard.pop();
        return;
      }
      target = this.state.players.get(payload.targetSessionId);
      if (!target || target.eliminated || target.protected) {
        if (this.allOthersProtectedOrEliminated(sid)) {
          this.pushLog(
            `${p.nickname} - ${CARD_NAMES_KR[payload.card]} (대상 없음)`,
            { kind: "play", actor: p.nickname, card: payload.card },
          );
          this.advanceTurn();
          return;
        }
        hand.push(payload.card);
        p.discard.pop();
        this.state.publicDiscard.pop();
        return;
      }
    }

    this.pushLog(
      `${p.nickname} → ${CARD_NAMES_KR[payload.card]}${
        target ? ` (대상: ${target.nickname})` : ""
      } 사용`,
      {
        kind: "play",
        actor: p.nickname,
        target: target?.nickname,
        card: payload.card,
      },
    );

    switch (payload.card) {
      case CARD.GUARD:
        if (target && payload.guardGuess && payload.guardGuess !== CARD.GUARD) {
          const targetHand =
            this.store.privateHands.get(target.sessionId) || [];
          if (targetHand.includes(payload.guardGuess)) {
            this.pushLog(
              `🎯 ${p.nickname}: ${target.nickname}는 ${CARD_NAMES_KR[payload.guardGuess]}였습니다 — 적중`,
              {
                kind: "reveal",
                actor: p.nickname,
                target: target.nickname,
                guess: payload.guardGuess,
              },
            );
            this.eliminate(
              target,
              `병사로 ${CARD_NAMES_KR[payload.guardGuess]} 적중`,
            );
          } else {
            this.pushLog(
              `❌ ${p.nickname}의 추측 (${CARD_NAMES_KR[payload.guardGuess]}) — 빗나감`,
              {
                kind: "reveal",
                actor: p.nickname,
                target: target.nickname,
                guess: payload.guardGuess,
              },
            );
          }
        }
        break;
      case CARD.PRIEST:
        if (target) {
          const targetHand =
            this.store.privateHands.get(target.sessionId) || [];
          const peeked = targetHand[0] ?? 0;
          client.send("priestPeek", {
            targetSessionId: target.sessionId,
            nickname: target.nickname,
            card: peeked,
          });
          this.pushLog(`🕯 ${p.nickname}가 ${target.nickname}의 손패를 엿봄`, {
            kind: "reveal",
            actor: p.nickname,
            target: target.nickname,
          });
        }
        break;
      case CARD.BARON:
        if (target) {
          const myHand = this.store.privateHands.get(sid) || [];
          const tHand = this.store.privateHands.get(target.sessionId) || [];
          const my = myHand[0] ?? 0;
          const th = tHand[0] ?? 0;
          this.pushLog(
            `⚖ 남작 비교: ${p.nickname} ${CARD_NAMES_KR[my]} vs ${target.nickname} ${CARD_NAMES_KR[th]}`,
            {
              kind: "reveal",
              actor: p.nickname,
              target: target.nickname,
              card: my,
              guess: th,
            },
          );
          if (my > th) this.eliminate(target, `남작 비교 패배`);
          else if (th > my) this.eliminate(p, `남작 비교 패배`);
          else
            this.pushLog(`남작 비교 무승부`, {
              kind: "reveal",
              actor: p.nickname,
              target: target.nickname,
            });
        }
        break;
      case CARD.HANDMAID:
        p.protected = true;
        break;
      case CARD.PRINCE: {
        const tid = payload.targetSessionId || sid;
        const t = this.state.players.get(tid);
        if (!t || t.eliminated) break;
        if (tid !== sid && t.protected) break;
        const tHand = this.store.privateHands.get(tid) || [];
        const discarded = tHand.shift();
        if (discarded === CARD.PRINCESS) {
          t.discard.push(discarded);
          this.state.publicDiscard.push(discarded);
          this.eliminate(t, `왕자로 공주 버림`);
        } else if (discarded !== undefined) {
          t.discard.push(discarded);
          this.state.publicDiscard.push(discarded);
          let replacement: number | undefined;
          if (this.store.deck.length > 0) {
            replacement = this.store.deck.shift();
          } else {
            replacement = this.store.burned;
            this.store.burned = -1;
          }
          if (replacement !== undefined && replacement !== -1) {
            tHand.push(replacement);
          }
          this.store.privateHands.set(tid, tHand);
          this.pushLog(
            `🌀 왕자: ${t.nickname}는 ${CARD_NAMES_KR[discarded]}를 버리고 다시 뽑음`,
            {
              kind: "reveal",
              actor: p.nickname,
              target: t.nickname,
              card: discarded,
            },
          );
        }
        break;
      }
      case CARD.KING:
        if (target) {
          const myHand = this.store.privateHands.get(sid) || [];
          const tHand = this.store.privateHands.get(target.sessionId) || [];
          this.store.privateHands.set(sid, tHand);
          this.store.privateHands.set(target.sessionId, myHand);
          this.pushLog(
            `👑 ${p.nickname} ⇄ ${target.nickname} 손패 교환`,
            {
              kind: "reveal",
              actor: p.nickname,
              target: target.nickname,
            },
          );
        }
        break;
      case CARD.COUNTESS:
        break;
      case CARD.PRINCESS:
        this.eliminate(p, `공주 버림`);
        break;
    }

    this.syncHands();
    this.syncDeck();
    if (this.checkRoundEnd()) return;
    this.advanceTurn();
  }

  private allOthersProtectedOrEliminated(sid: string): boolean {
    for (const p of this.state.players.values()) {
      if (p.sessionId === sid) continue;
      if (!p.eliminated && !p.protected) return false;
    }
    return true;
  }

  private eliminate(p: Player, reason: string) {
    if (p.eliminated) return;
    p.eliminated = true;
    const hand = this.store.privateHands.get(p.sessionId) || [];
    for (const c of hand) {
      p.discard.push(c);
      this.state.publicDiscard.push(c);
    }
    this.store.privateHands.set(p.sessionId, []);
    this.pushLog(`💀 ${p.nickname} 탈락 — ${reason}`, {
      kind: "result",
      actor: p.nickname,
    });
  }

  private advanceTurn() {
    const alive = this.state.turnOrder.filter((id) => {
      const p = this.state.players.get(id);
      return p && !p.eliminated;
    });
    if (alive.length <= 1) {
      this.checkRoundEnd();
      return;
    }
    let idx = this.state.turnIndex;
    for (let i = 0; i < this.state.turnOrder.length; i++) {
      idx = (idx + 1) % this.state.turnOrder.length;
      const cand = this.state.players.get(this.state.turnOrder[idx]);
      if (cand && !cand.eliminated) {
        this.state.turnIndex = idx;
        break;
      }
    }
    this.beginTurn();
  }

  private checkRoundEnd(): boolean {
    const alive = Array.from(this.state.players.values()).filter(
      (p) => !p.eliminated,
    );
    if (alive.length <= 1) {
      const winner = alive[0];
      this.finishRound(winner);
      return true;
    }
    return false;
  }

  private endRoundByDeckEmpty() {
    const alive = Array.from(this.state.players.values()).filter(
      (p) => !p.eliminated,
    );
    let best: Player | undefined;
    let bestCard = -1;
    for (const p of alive) {
      const card = (this.store.privateHands.get(p.sessionId) || [0])[0] ?? 0;
      if (card > bestCard) {
        bestCard = card;
        best = p;
      } else if (card === bestCard && best) {
        const sumP = p.discard.reduce((a, b) => a + b, 0);
        const sumB = best.discard.reduce((a, b) => a + b, 0);
        if (sumP > sumB) best = p;
      }
    }
    this.finishRound(best);
  }

  private finishRound(winner: Player | undefined) {
    if (winner) {
      winner.tokens += 1;
      this.state.roundWinnerId = winner.sessionId;
      this.state.lastWinnerId = winner.sessionId;
      this.pushLog(
        `🏆 라운드 승리: ${winner.nickname} (총 ${winner.tokens}점)`,
        { kind: "result", actor: winner.nickname },
      );
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
    for (const [sid, p] of this.state.players.entries()) {
      const hand = this.store.privateHands.get(sid) || [];
      for (const c of hand) {
        this.pushLog(`🔍 ${p.nickname}의 최종 손패: ${CARD_NAMES_KR[c]}`, {
          kind: "reveal",
          actor: p.nickname,
          card: c,
        });
      }
    }
    this.syncHands(true);
  }

  // ---------- Sync helpers ----------

  private syncHands(reveal: boolean = false) {
    for (const [sid, p] of this.state.players.entries()) {
      const hand = this.store.privateHands.get(sid) || [];
      p.hand = new ArraySchema<number>(...hand);
      const client = this.clients.find((c) => c.sessionId === sid);
      if (!client) continue;
      client.send("hand", { cards: hand });
    }
    if (reveal) {
      for (const c of this.clients) {
        const allHands: Record<string, number[]> = {};
        for (const [sid] of this.state.players.entries()) {
          allHands[sid] = this.store.privateHands.get(sid) || [];
        }
        c.send("revealHands", allHands);
      }
    }
  }

  private syncDeck() {
    this.state.deckRemaining = this.store.deck.length;
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
    e.kind = extras.kind ?? "info";
    e.actor = extras.actor ?? "";
    e.target = extras.target ?? "";
    e.card = extras.card ?? 0;
    e.guess = extras.guess ?? 0;
    this.state.log.push(e);
    if (this.state.log.length > 200) this.state.log.shift();
  }
}

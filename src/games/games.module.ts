import { Module } from "@nestjs/common";
import { GAME_REGISTRY } from "./registry.js";

/** DI 토큰 — 컨트롤러/서비스에서 @Inject(GAME_REGISTRY_TOKEN)으로 주입. */
export const GAME_REGISTRY_TOKEN = "GAME_REGISTRY";

/**
 * 게임 슬라이스 도메인의 Nest 진입점. 각 게임(love-letter/mafia/tetris/
 * multitask/yeouido)은 이 폴더 아래 독립 슬라이스(room/state/rules/…)로
 * 살고, Colyseus가 직접 인스턴스화한다 — Nest에는 레지스트리(메타데이터)만
 * 노출한다.
 */
@Module({
  providers: [{ provide: GAME_REGISTRY_TOKEN, useValue: GAME_REGISTRY }],
  exports: [GAME_REGISTRY_TOKEN],
})
export class GamesModule {}

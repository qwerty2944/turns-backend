import { Module } from "@nestjs/common";
import type { GameManifest } from "./types.js";
import {
  LOVE_LETTER_MANIFEST,
  LoveLetterModule,
} from "./love-letter/love-letter.module.js";
import { MAFIA_MANIFEST, MafiaModule } from "./mafia/mafia.module.js";
import {
  MULTITASK_MANIFEST,
  MultitaskModule,
} from "./multitask/multitask.module.js";
import { TETRIS_MANIFEST, TetrisModule } from "./tetris/tetris.module.js";
import { YEOUIDO_MANIFEST, YeouidoModule } from "./yeouido/yeouido.module.js";

/** DI 토큰 — 컨트롤러/서비스에서 @Inject(GAME_REGISTRY_TOKEN)으로 주입. */
export const GAME_REGISTRY_TOKEN = "GAME_REGISTRY";

/**
 * 게임 도메인의 Nest 조립점. 각 게임은 자기 폴더의
 * <game>.module(매니페스트) + room(게이트웨이) + <game>.service(게임 로직)
 * 로 구성된 독립 슬라이스이고, 여기서 매니페스트들을 DI로 합성해
 * 레지스트리로 노출한다. (Colyseus 부트스트랩은 Nest 이전에 동작해야
 * 하므로 registry.ts의 정적 배열도 함께 유지된다 — 같은 매니페스트 객체다.)
 */
@Module({
  imports: [
    LoveLetterModule,
    MafiaModule,
    MultitaskModule,
    TetrisModule,
    YeouidoModule,
  ],
  providers: [
    {
      provide: GAME_REGISTRY_TOKEN,
      useFactory: (...manifests: GameManifest[]) => manifests,
      inject: [
        LOVE_LETTER_MANIFEST,
        MAFIA_MANIFEST,
        MULTITASK_MANIFEST,
        TETRIS_MANIFEST,
        YEOUIDO_MANIFEST,
      ],
    },
  ],
  exports: [GAME_REGISTRY_TOKEN],
})
export class GamesModule {}

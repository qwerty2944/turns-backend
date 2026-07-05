import { Module } from "@nestjs/common";
import { loveLetterManifest } from "./index.js";

export const LOVE_LETTER_MANIFEST = "LOVE_LETTER_MANIFEST";

/** 러브레터 슬라이스의 Nest 진입점 — 매니페스트를 DI로 노출한다. */
@Module({
  providers: [{ provide: LOVE_LETTER_MANIFEST, useValue: loveLetterManifest }],
  exports: [LOVE_LETTER_MANIFEST],
})
export class LoveLetterModule {}

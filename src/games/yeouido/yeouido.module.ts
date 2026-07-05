import { Module } from "@nestjs/common";
import { yeouidoManifest } from "./index.js";

export const YEOUIDO_MANIFEST = "YEOUIDO_MANIFEST";

/** 여의도 대전 슬라이스의 Nest 진입점 — 매니페스트를 DI로 노출한다. */
@Module({
  providers: [{ provide: YEOUIDO_MANIFEST, useValue: yeouidoManifest }],
  exports: [YEOUIDO_MANIFEST],
})
export class YeouidoModule {}

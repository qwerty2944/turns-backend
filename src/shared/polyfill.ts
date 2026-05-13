// Side-effect module — must be imported BEFORE any @colyseus/schema class
// is loaded so that `@type` decorators can write into `constructor[Symbol.metadata]`.
(Symbol as any).metadata ??= Symbol.for("Symbol.metadata");
export {};

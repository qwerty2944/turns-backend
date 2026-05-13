// In-memory user store. Wiped on process restart — fine for MVP, swap to a
// real DB later (the public API surface here is what auth/routes.ts consumes).
export type UserRow = {
  id: number;
  email: string;
  password_hash: string;
  nickname: string;
  created_at: number;
};

const byId = new Map<number, UserRow>();
const byEmail = new Map<string, UserRow>();
let nextId = 1;

export const userRepo = {
  async findByEmail(email: string): Promise<UserRow | undefined> {
    return byEmail.get(email.toLowerCase());
  },

  async findById(id: number): Promise<UserRow | undefined> {
    return byId.get(id);
  },

  async create(
    email: string,
    passwordHash: string,
    nickname: string,
  ): Promise<UserRow> {
    const row: UserRow = {
      id: nextId++,
      email,
      password_hash: passwordHash,
      nickname,
      created_at: Date.now(),
    };
    byId.set(row.id, row);
    byEmail.set(email.toLowerCase(), row);
    return row;
  },
};

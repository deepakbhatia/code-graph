import { Repo } from "./auth/repo";

export function run(): string {
  const repo = new Repo();
  return repo.save();
}

export function brokenFind(): void {
  find();
}

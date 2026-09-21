import { Repo as AuthRepo } from "../name-collision/auth/repo";
import { Repo as GitRepo } from "../name-collision/git/repo";

export function pick(kind: string) {
  const repo = kind === "auth" ? new AuthRepo() : new GitRepo();
  return repo.save();
}

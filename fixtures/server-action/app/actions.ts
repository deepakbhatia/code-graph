"use server";

import { persist } from "../lib/db";

export async function saveItem(id: string): Promise<string> {
  return persist(id);
}

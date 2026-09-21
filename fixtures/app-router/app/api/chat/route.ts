import { saveChat } from "../../../lib/chat";

export async function GET(): Promise<Response> {
  return new Response("ok");
}

export async function POST(request: Request): Promise<Response> {
  return saveChat(request);
}

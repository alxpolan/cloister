import { type NextRequest } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8080";
const API_TOKEN = process.env.API_TOKEN ?? "";

export const dynamic = "force-dynamic";

async function proxy(req: NextRequest, path: string[]) {
  const search = req.nextUrl.search;
  const target = `${BACKEND_URL}/${path.join("/")}${search}`;
  const headers: Record<string, string> = {};
  const contentType = req.headers.get("content-type");

  if (contentType) headers["content-type"] = contentType;
  if (API_TOKEN) headers.authorization = `Bearer ${API_TOKEN}`;

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const res = await fetch(target, {
    method: req.method,
    headers,
    body: hasBody ? await req.arrayBuffer() : undefined,
    cache: "no-store",
  });

  const responseHeaders = new Headers();
  const ct = res.headers.get("content-type");
  
  if (ct) responseHeaders.set("content-type", ct);
  const cc = res.headers.get("cache-control");
  if (cc) responseHeaders.set("cache-control", cc);

  return new Response(res.body, {
    status: res.status,
    headers: responseHeaders,
  });
}

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  return proxy(req, (await ctx.params).path);
}
export async function POST(req: NextRequest, ctx: Ctx) {
  return proxy(req, (await ctx.params).path);
}
export async function PUT(req: NextRequest, ctx: Ctx) {
  return proxy(req, (await ctx.params).path);
}
export async function DELETE(req: NextRequest, ctx: Ctx) {
  return proxy(req, (await ctx.params).path);
}

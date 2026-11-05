import { NextResponse } from 'next/server';

export function ok(data) {
  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
}
export function fail(e, status = 400) {
  return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });
}

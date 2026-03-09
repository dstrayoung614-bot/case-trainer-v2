import { NextRequest, NextResponse } from 'next/server';

// Middleware не выполняет редиректов — авторизация проверяется на уровне страниц (client-side Firebase auth)
export function middleware(_req: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

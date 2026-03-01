import { NextRequest, NextResponse } from 'next/server';

// Публичные маршруты — доступны без авторизации
const PUBLIC_PATHS = ['/', '/login', '/register'];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Пропускаем публичные пути и статику
  if (
    pathname === '/' ||
    PUBLIC_PATHS.filter(p => p !== '/').some((p) => pathname.startsWith(p)) ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  // Проверяем сессионную куку Firebase (будет установлена после логина)
  const session = req.cookies.get('session')?.value;
  if (!session) {
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

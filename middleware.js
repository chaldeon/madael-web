import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';

export async function middleware(request) {
  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request: { headers: request.headers } });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh session kalau expired — WAJIB dipanggil sebelum cek user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isAdminRoute = pathname.startsWith('/admin');
  const PUBLIC_EMPLOYEE_PATHS = [
    '/employee/login',
    '/employee/forgot-password',
    '/employee/reset-password',
  ];
  const isEmployeeRoute =
    pathname.startsWith('/employee') && !PUBLIC_EMPLOYEE_PATHS.includes(pathname);

  if (isAdminRoute && !user) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/login';
    redirectUrl.searchParams.set('redirectedFrom', pathname);
    return NextResponse.redirect(redirectUrl);
  }

  if (isEmployeeRoute && !user) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/employee/login';
    redirectUrl.searchParams.set('redirectedFrom', pathname);
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}

export const config = {
  matcher: ['/admin/:path*', '/employee/:path*'],
};
// Vercel CDN이 옛 HTML을 stale-while-revalidate로 들고 있지 않도록
// 페이지를 동적 렌더링으로 강제. (실데이터는 클라이언트 fetch라 성능 영향 미미)
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function PlForecastLayout({ children }: { children: React.ReactNode }) {
  return children;
}

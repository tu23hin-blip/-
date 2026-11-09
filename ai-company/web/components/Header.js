'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { usePoll } from '@/lib/usePoll';

const TABS = [
  { href: '/', label: '経営ダッシュボード', match: (p) => p === '/' || p.startsWith('/reports') },
  { href: '/divisions', label: '事業部ビュー', match: (p) => p.startsWith('/divisions') },
  { href: '/inbox', label: '承認待ち', match: (p) => p.startsWith('/inbox'), badge: true },
  { href: '/office', label: 'オフィス', match: (p) => p.startsWith('/office') },
];

export default function Header() {
  const pathname = usePathname() || '/';
  const { data } = usePoll('/api/inbox?summary=1');
  const pending = data?.pending ?? 0;
  return (
    <header className="header">
      <div className="header-inner">
        <Link href="/" className="brand">AI会社</Link>
        <nav className="tabs" aria-label="画面の切り替え">
          {TABS.map((t) => (
            <Link key={t.href} href={t.href} className={`tab ${t.match(pathname) ? 'active' : ''}`} aria-current={t.match(pathname) ? 'page' : undefined}>
              {t.label}
              {t.badge && pending > 0 && <span className="badge" aria-label={`承認待ち ${pending} 件`}>{pending}</span>}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}

import './globals.css';
import Header from '@/components/Header';

export const metadata = { title: 'AI会社', description: '事業部AIの動きと成果を見る経営ダッシュボード' };
export const viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }) {
  return (
    <html lang="ja">
      <body>
        <Header />
        <main>{children}</main>
      </body>
    </html>
  );
}

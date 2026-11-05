import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db, queries } from '@/lib/engine';
import Markdown from '@/components/Markdown';

export const dynamic = 'force-dynamic';

export default async function ReportPage({ params }) {
  const { id } = await params;
  const o = queries.outputDetail(db(), Number(id));
  if (!o || o.kind !== 'report') notFound();
  const others = db().prepare("SELECT id, title FROM outputs WHERE kind = 'report' AND json_extract(meta,'$.type') = 'weekly_report' ORDER BY created_at DESC LIMIT 12").all();
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{o.title || '週次レポート'}</h1>
          <div className="sub">{o.division_name} ・ {new Date(o.created_at).toLocaleString('ja-JP')} ・ {o.file_path}</div>
        </div>
        <Link href="/">← ダッシュボード</Link>
      </div>
      <article className="card"><Markdown text={o.content} /></article>
      {others.length > 1 && (
        <section className="section card">
          <h2>過去のレポート</h2>
          <ul>{others.map((r) => <li key={r.id}><Link href={`/reports/${r.id}`}>{r.title || `レポート #${r.id}`}</Link></li>)}</ul>
        </section>
      )}
    </>
  );
}

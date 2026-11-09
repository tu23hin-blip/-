'use client';
import { useState } from 'react';
import { post, copyText } from '@/lib/usePoll';
import { KIND_LABEL, fmtTime, fmtNum, isNum } from '@/lib/format';
import Markdown from './Markdown';

const APPROVAL_LABEL = { pending: '承認待ち', approved: '承認済み', rejected: '却下' };

/** 成果物1件。mode: inbox（承認操作）／approved（コピーと投稿URL登録）／view（閲覧のみ） */
export default function OutputCard({ output, mode = 'view', onChange, showDivision = false }) {
  const [content, setContent] = useState(output.content ?? null);
  const [open, setOpen] = useState(mode !== 'view');
  const [comment, setComment] = useState('');
  const [url, setUrl] = useState(output.published_url || '');
  const [imp, setImp] = useState('');
  const [clk, setClk] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const meta = output.meta || {};
  const text = content ?? output.preview_text ?? '';
  const isArticle = output.kind === 'note_article' || output.kind === 'report' || output.kind === 'script';

  const act = async (action, extra = {}) => {
    if (action === 'revise' && !comment.trim()) { setMsg('修正コメントを入力してください'); return; }
    setBusy(true); setMsg(null);
    try {
      await post(`/api/outputs/${output.id}`, { action, comment: comment.trim() || undefined, ...extra });
      setComment('');
      if (action === 'metrics') { setImp(''); setClk(''); }
      setMsg(action === 'revise' ? '修正タスクを積みました。次の実行で修正版が承認待ちに出ます。'
        : action === 'metrics' ? '保存しました（投稿ごとに1行で上書き）。' : '更新しました');
      onChange?.();
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  };

  const loadFull = async () => {
    if (content == null) {
      const res = await fetch(`/api/outputs/${output.id}`);
      if (res.ok) setContent((await res.json()).content ?? output.preview_text);
    }
    setOpen((o) => !o);
  };

  const copy = async () => setMsg((await copyText(text)) ? 'コピーしました。X / note に手動で貼り付けて投稿してください。' : 'コピーできませんでした。本文を選択してコピーしてください。');
  const chars = Array.from(text.trim()).length;

  return (
    <div className="out">
      <div className="out-head">
        <div>
          <span className="out-title">{output.title || KIND_LABEL[output.kind]}</span>{' '}
          <span className="pill">{KIND_LABEL[output.kind] || output.kind}</span>{' '}
          {mode === 'view' && <span className="pill">{APPROVAL_LABEL[output.approval]}</span>}
        </div>
        <span className="sub">{showDivision && `${output.division_name} ・ `}{fmtTime(output.created_at)}</span>
      </div>
      {meta.theme && <div className="sub">テーマ: {meta.theme}</div>}
      {meta.hypothesis && <div className="sub hypothesis">仮説: {meta.hypothesis}</div>}
      {Array.isArray(meta.warnings) && meta.warnings.length > 0 && (
        <ul className="warn-list">{meta.warnings.map((w, i) => <li key={i}>⚠ {w}</li>)}</ul>
      )}
      {Array.isArray(meta.questions) && meta.questions.length > 0 && (
        <ul className="warn-list">{meta.questions.map((w, i) => <li key={i}>？ 確認したい点: {w}</li>)}</ul>
      )}
      {open ? (
        isArticle ? <div className="preview"><Markdown text={text} /></div> : <div className="preview">{text}</div>
      ) : (
        <div className="preview" style={{ maxHeight: 90 }}>{output.preview_text}</div>
      )}
      {output.kind === 'x_post' && open && <div className="charcount">{chars}字</div>}
      {Array.isArray(meta.comments) && meta.comments.length > 0 && (
        <div className="sub" style={{ marginTop: 6 }}>コメント: {meta.comments.map((c) => c.text).join(' / ')}</div>
      )}

      {mode === 'view' && (
        <div className="actions"><button className="btn" onClick={loadFull}>{open ? '閉じる' : '全文を見る'}</button>
          {output.published_url && <a href={output.published_url} target="_blank" rel="noreferrer">投稿を開く</a>}</div>
      )}

      {mode === 'inbox' && (
        <>
          <textarea className="comment" rows={2} placeholder="コメント（修正依頼のときは必須）" value={comment} onChange={(e) => setComment(e.target.value)} />
          <div className="actions">
            <button className="btn primary" disabled={busy} onClick={() => act('approve')}>承認</button>
            <button className="btn danger" disabled={busy} onClick={() => act('reject')}>却下</button>
            <button className="btn" disabled={busy} onClick={() => act('revise')}>修正を依頼</button>
            {meta.type === 'goal_update' && <span className="sub">承認すると今週の目標が書き換わります</span>}
          </div>
        </>
      )}

      {mode === 'approved' && (
        <>
          <div className="actions">
            <button className="btn" onClick={copy}>本文をコピー</button>
            {output.published_url
              ? <span className="sub">投稿済み: <a href={output.published_url} target="_blank" rel="noreferrer">{output.published_url}</a></span>
              : <span className="sub">手動で投稿したらURLを登録してください（投稿数が記録されます）</span>}
          </div>
          {output.published_url && (
            <form className="post-metrics" onSubmit={(e) => { e.preventDefault(); act('metrics', { impressions: imp, clicks: clk }); }}>
              <div className="sub">
                投稿の数字（入力する時点の累計。投稿ごとに1行で上書き。X は毎朝6時に自動で更新）
                {isNum(output.post_impressions) || isNum(output.post_clicks)
                  ? ` ・ いまの値: インプ ${fmtNum(output.post_impressions)} / クリック ${fmtNum(output.post_clicks)}`
                  : ' ・ まだありません'}
              </div>
              <div className="actions" style={{ marginTop: 4 }}>
                <label className="field">インプレッション
                  <input className="url" inputMode="numeric" placeholder="例: 1200" value={imp} onChange={(e) => setImp(e.target.value)} />
                </label>
                <label className="field">クリック
                  <input className="url" inputMode="numeric" placeholder="例: 25" value={clk} onChange={(e) => setClk(e.target.value)} />
                </label>
                <button className="btn" type="submit" disabled={busy || (!imp.trim() && !clk.trim())}>数字を保存</button>
              </div>
            </form>
          )}
          {!output.published_url && (
            <div className="actions" style={{ marginTop: 4 }}>
              <input className="url" style={{ marginTop: 0, flex: 1, minWidth: 200 }} placeholder="https://x.com/…" value={url} onChange={(e) => setUrl(e.target.value)} />
              <button className="btn" disabled={busy || !url} onClick={() => act('publish', { url })}>投稿済みにする</button>
            </div>
          )}
        </>
      )}
      {msg && <div className="sub" style={{ marginTop: 6 }} role="status">{msg}</div>}
    </div>
  );
}

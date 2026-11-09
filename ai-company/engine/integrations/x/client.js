// X API v2 の最小クライアント（読み取り専用）。投稿系のAPIはあえて作らない（投稿は人が手動で行う）。
// 使うのは2つだけ:
//   GET /2/users/me            … 自分のユーザーID（最初の1回だけ。以後は保存した値を使う）
//   GET /2/users/{id}/tweets   … 自分の投稿の数字（自分のアプリで自分の投稿を読む = Owned Reads、1件 $0.001）
// GET /2/tweets?ids=... は通常料金（1件 $0.005）なので使わない。
import { oauth1Header } from './oauth1.js';

export const X_API_BASE = 'https://api.x.com';
export const OWNED_READ_USD = 0.001;
export const TWEET_FIELDS = 'public_metrics,non_public_metrics,created_at';

export class XApiError extends Error {
  constructor(message, { status = null, title = null, retryable = true } = {}) {
    super(message);
    this.name = 'XApiError';
    this.status = status;
    this.title = title;
    this.retryable = retryable;
  }
}

/** HTTP エラーを日本語のわかりやすいメッセージにする（キーの値は絶対に含めない） */
export function explainError(status, body, envPrefix) {
  const title = body?.title || body?.errors?.[0]?.title || '';
  const detail = body?.detail || body?.errors?.[0]?.message || '';
  const where = envPrefix ? `（.env の ${envPrefix}_API_KEY / ${envPrefix}_API_SECRET / ${envPrefix}_ACCESS_TOKEN / ${envPrefix}_ACCESS_TOKEN_SECRET）` : '';
  if (status === 402 || /CreditsDepleted/i.test(title)) {
    return new XApiError(`X API のクレジットが切れています（402 CreditsDepleted）。X の開発者コンソール（console.x.com）でクレジットを追加してください。今日の取り込みはしていません`, { status, title, retryable: false });
  }
  if (status === 401) {
    return new XApiError(`X API のキーが正しくありません（401 認証エラー）${where}。キーを作り直した場合は4つとも入れ替えてください`, { status, title, retryable: false });
  }
  if (status === 403) {
    return new XApiError(`X API のキーかアプリの権限が正しくありません（403 ${title || 'Forbidden'}）${where}。アプリの権限（Read 以上）と、キーが同じアプリのものかを確認してください`, { status, title, retryable: false });
  }
  if (status === 429) {
    return new XApiError(`X API の回数制限にかかりました（429）。しばらく待ってから再実行してください`, { status, title, retryable: true });
  }
  return new XApiError(`X API がエラーを返しました（${status}${title ? ` ${title}` : ''}${detail ? `: ${String(detail).slice(0, 200)}` : ''}）`, { status, title, retryable: status >= 500 });
}

/**
 * @param {{apiKey,apiSecret,accessToken,accessTokenSecret}} creds
 * @param {{fetchImpl?:Function, baseUrl?:string, envPrefix?:string, timeoutMs?:number}} opts
 */
export function createXClient(creds, { fetchImpl = globalThis.fetch, baseUrl = X_API_BASE, envPrefix = null, timeoutMs = 30000 } = {}) {
  const calls = [];

  async function get(pathname, params = {}) {
    const url = `${baseUrl}${pathname}`;
    const qs = new URLSearchParams(params).toString();
    const auth = oauth1Header({ method: 'GET', url, params, creds });
    calls.push({ path: pathname, params });
    let res;
    try {
      res = await fetchImpl(qs ? `${url}?${qs}` : url, {
        method: 'GET',
        headers: { Authorization: auth, 'User-Agent': 'ai-company-metrics/1.0' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new XApiError(`X API に接続できませんでした（${e.name === 'TimeoutError' ? 'タイムアウト' : e.message}）`, { retryable: true });
    }
    let body = null;
    try { body = await res.json(); } catch { /* 本文なし */ }
    if (!res.ok) throw explainError(res.status, body, envPrefix);
    return body;
  }

  return {
    calls,
    /** 自分のユーザー情報（id, username） */
    async getMe() {
      const body = await get('/2/users/me');
      if (!body?.data?.id) throw new XApiError('X API の /2/users/me からユーザーIDを取得できませんでした');
      return { id: body.data.id, username: body.data.username || null };
    },
    /** 自分の投稿（start_time 以降）を1回で取る */
    async getOwnTweets(userId, { startTime, maxResults = 100 } = {}) {
      const body = await get(`/2/users/${encodeURIComponent(userId)}/tweets`, {
        max_results: String(maxResults),
        start_time: startTime,
        'tweet.fields': TWEET_FIELDS,
      });
      return { tweets: body?.data || [], nextToken: body?.meta?.next_token || null, resultCount: body?.meta?.result_count ?? (body?.data || []).length };
    },
  };
}

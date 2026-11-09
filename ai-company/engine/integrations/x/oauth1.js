// OAuth 1.0a（HMAC-SHA1）の署名。外部ライブラリを使わず node:crypto で作る。
// 署名に使う秘密情報（API Secret / Access Token Secret）はヘッダーに含まれない。
import crypto from 'node:crypto';

/** RFC 3986 のパーセントエンコード（OAuth 1.0a 仕様） */
export function percentEncode(s) {
  return encodeURIComponent(String(s)).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * Authorization ヘッダーの値を作る。
 * @param {object} p
 * @param {string} p.method   GET / POST
 * @param {string} p.url      クエリなしの URL（https://api.x.com/2/users/me）
 * @param {object} p.params   クエリ・フォームのパラメータ（署名に含める）
 * @param {{apiKey,apiSecret,accessToken,accessTokenSecret}} p.creds
 * @param {string} [p.nonce] [p.timestamp] テスト用に固定できる
 */
export function oauth1Header({ method, url, params = {}, creds, nonce, timestamp }) {
  const oauth = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: nonce || crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(timestamp || Math.floor(Date.now() / 1000)),
    oauth_token: creds.accessToken,
    oauth_version: '1.0',
  };
  const all = { ...params, ...oauth };
  const paramString = Object.keys(all)
    .map((k) => [percentEncode(k), percentEncode(all[k])])
    .sort(([ak, av], [bk, bv]) => (ak === bk ? (av < bv ? -1 : av > bv ? 1 : 0) : ak < bk ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const base = [method.toUpperCase(), percentEncode(url), percentEncode(paramString)].join('&');
  const key = `${percentEncode(creds.apiSecret)}&${percentEncode(creds.accessTokenSecret)}`;
  const signature = crypto.createHmac('sha1', key).update(base).digest('base64');
  const header = { ...oauth, oauth_signature: signature };
  return 'OAuth ' + Object.keys(header).sort().map((k) => `${percentEncode(k)}="${percentEncode(header[k])}"`).join(', ');
}

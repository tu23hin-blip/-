// サーバー側だけで使う。engine/ の DB と記録ライブラリを共有する。
import 'server-only';
import { getDb, createRecorder } from '../../engine/db/index.js';
import * as queries from '../../engine/db/queries.js';

let rec = null;
export function db() { return getDb(); }
export function recorder() {
  if (!rec) rec = createRecorder(getDb());
  return rec;
}
export { queries };

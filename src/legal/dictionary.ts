import type { AdvertiserCategory, Severity } from '../domain/types.ts';

/**
 * 薬機法（医薬品医療機器等法）第66条〜68条・医薬品等適正広告基準、
 * および景品表示法（優良誤認・有利誤認・ステマ規制）に基づく NG 表現辞書。
 *
 * 重要な前提:
 *  - 同じ語でもカテゴリによって可否が変わる（例:「育毛」は化粧品NG／医薬部外品OK）。
 *    そのため categories（適用対象）と allowedIn（例外的に許容）を必ず持たせる。
 *  - ここは一次スクリーニング。最終判断は llm レビュー + 人の目（legal ロール）で行う。
 */
export type DictEntry = {
  id: string;
  law: 'yakkihou' | 'keihyo';
  /** 正規化後（全角→半角・記号除去・小文字化）のテキストに対して照合する */
  pattern: string;
  isRegex?: boolean;
  categories: AdvertiserCategory[] | 'all';
  allowedIn?: AdvertiserCategory[];
  severity: Severity;
  reason: string;
  suggestion: string;
};

const COSMETIC_LIKE: AdvertiserCategory[] = ['cosmetics', 'quasi_drug'];
const INGESTIBLE: AdvertiserCategory[] = ['supplement', 'food_with_claims'];

export const DICTIONARY: DictEntry[] = [
  // ============ 薬機法: 疾病の治療・予防（全カテゴリで最も重い） ============
  {
    id: 'yk-cure-01', law: 'yakkihou', pattern: '治る', categories: 'all', allowedIn: ['drug'],
    severity: 'block',
    reason: '疾病の治療効果の標ぼう。医薬品以外では薬機法第68条（未承認医薬品の広告禁止）に抵触する。',
    suggestion: '「〜をサポート」「健やかな状態を保つ」など、治療を想起させない表現に置き換える。',
  },
  {
    id: 'yk-cure-02', law: 'yakkihou', pattern: '治療', categories: 'all', allowedIn: ['drug', 'medical_device'],
    severity: 'block',
    reason: '医薬品的な効能効果（治療）の標ぼう。',
    suggestion: '「ケア」「お手入れ」等の表現に変更する。',
  },
  {
    id: 'yk-cure-03', law: 'yakkihou', pattern: '効く', categories: 'all', allowedIn: ['drug'],
    severity: 'block',
    reason: '医薬品的効能の断定。食品・化粧品では標ぼうできない。',
    suggestion: '体験に基づく感想表現、または承認範囲内の効能に限定する。',
  },
  {
    id: 'yk-cure-04', law: 'yakkihou', pattern: '(がん|ガン|癌|糖尿病|高血圧|アトピー|うつ病|認知症)', isRegex: true,
    categories: 'all', allowedIn: ['drug'], severity: 'block',
    reason: '特定疾病名の使用は、疾病の治療・予防効果の暗示にあたる。',
    suggestion: '疾病名を削除し、健康維持の一般的表現にとどめる。',
  },
  {
    id: 'yk-cure-05', law: 'yakkihou', pattern: '予防', categories: [...INGESTIBLE, 'cosmetics'],
    allowedIn: ['drug', 'quasi_drug'], severity: 'block',
    reason: '疾病予防効果の標ぼう。食品・化粧品では不可（医薬部外品は承認効能の範囲内のみ可）。',
    suggestion: '「毎日の習慣に」等、予防効果を示唆しない表現に変更する。',
  },
  {
    id: 'yk-cure-06', law: 'yakkihou', pattern: '副作用がない', categories: 'all', severity: 'block',
    reason: '安全性の絶対的保証。医薬品等適正広告基準で明確に禁止されている。',
    suggestion: '安全性の断定表現を削除する。',
  },
  {
    id: 'yk-cure-07', law: 'yakkihou', pattern: '(絶対に安全|100%安全|完全に安全)', isRegex: true,
    categories: 'all', severity: 'block',
    reason: '安全性の保証表現。',
    suggestion: '「安全性試験を実施しています」等、事実の範囲で記載する。',
  },

  // ============ 薬機法: 化粧品（効能の範囲56項目を超える表現） ============
  {
    id: 'yk-cos-01', law: 'yakkihou', pattern: '(シミが消える|しみが消える|シワが消える|しわが消える)', isRegex: true,
    categories: COSMETIC_LIKE, severity: 'block',
    reason: '化粧品の効能効果の範囲（56項目）を超える。「消える」は医薬品的効能。',
    suggestion: '「乾燥による小ジワを目立たなくする（効能評価試験済み）」等、承認された表現に置き換える。',
  },
  {
    id: 'yk-cos-02', law: 'yakkihou', pattern: '美白', categories: ['cosmetics'], allowedIn: ['quasi_drug'],
    severity: 'block',
    reason: '「美白」は薬用化粧品（医薬部外品）の承認効能。化粧品では標ぼうできない。',
    suggestion: '化粧品では「透明感のある肌へ」「明るい印象の肌に見せる」等の表現にする。',
  },
  {
    id: 'yk-cos-03', law: 'yakkihou', pattern: '(アンチエイジング|若返り|若返る|老化を防ぐ)', isRegex: true,
    categories: COSMETIC_LIKE, severity: 'block',
    reason: '老化防止・若返りは化粧品の効能範囲外。',
    suggestion: '「エイジングケア（年齢に応じたお手入れ）」と定義付きで用いる。',
  },
  {
    id: 'yk-cos-04', law: 'yakkihou', pattern: '(細胞が活性化|細胞を再生|肌が生まれ変わる)', isRegex: true,
    categories: COSMETIC_LIKE, severity: 'block',
    reason: '身体の組織・細胞への作用の標ぼうは医薬品的効能。',
    suggestion: '角層までの働きに限定した表現（「角層のうるおいを保つ」等）にする。',
  },
  {
    id: 'yk-cos-05', law: 'yakkihou', pattern: '(発毛|育毛|毛が生える)', isRegex: true,
    categories: ['cosmetics'], allowedIn: ['quasi_drug', 'drug'], severity: 'block',
    reason: '発毛・育毛効果は医薬部外品／医薬品の承認効能。化粧品では不可。',
    suggestion: '化粧品では「頭皮を健やかに保つ」「髪にハリ・コシを与える」にとどめる。',
  },
  {
    id: 'yk-cos-06', law: 'yakkihou', pattern: '(毛穴が消える|毛穴がなくなる|ニキビが治る)', isRegex: true,
    categories: COSMETIC_LIKE, severity: 'block',
    reason: '化粧品の効能範囲外／疾病治療の標ぼう。',
    suggestion: '「毛穴の目立たない肌に見せる」「肌を清浄にする」等に変更する。',
  },
  {
    id: 'yk-cos-07', law: 'yakkihou', pattern: '(即効|一晩で|3日で|一週間で)', isRegex: true,
    categories: COSMETIC_LIKE, severity: 'warn',
    reason: '速効性の強調は効能効果の保証・誇大にあたるおそれがある。',
    suggestion: '期間の断定を避け、使用実感の個人の感想であることを明示する。',
  },

  // ============ 薬機法: 健康食品・サプリ（身体の構造・機能への影響） ============
  {
    id: 'yk-sup-01', law: 'yakkihou', pattern: '(痩せる|やせる|脂肪が燃焼|脂肪を分解)', isRegex: true,
    categories: INGESTIBLE, severity: 'block',
    reason: '食品による痩身・身体機能への作用の標ぼうは医薬品的効能にあたる。',
    suggestion: '「食事管理・運動と合わせた生活習慣のサポート」等、体験談・生活提案の枠にとどめる。',
  },
  {
    id: 'yk-sup-02', law: 'yakkihou', pattern: '(血圧を下げる|血糖値を下げる|コレステロールを下げる)', isRegex: true,
    categories: ['supplement'], allowedIn: ['food_with_claims', 'drug'], severity: 'block',
    reason: '身体の特定部位・機能への作用。機能性表示食品／特保の届出範囲外では標ぼうできない。',
    suggestion: '機能性表示食品として届出済みの場合は届出表示をそのまま用い、届出番号を併記する。',
  },
  {
    id: 'yk-sup-03', law: 'yakkihou', pattern: '(免疫力アップ|免疫力を高める|デトックス|毒素を排出)', isRegex: true,
    categories: INGESTIBLE, severity: 'block',
    reason: '身体機能の増強・排出作用の標ぼう。科学的根拠の有無を問わず食品では不可。',
    suggestion: '成分の一般的な説明にとどめ、身体への作用を断定しない。',
  },
  {
    id: 'yk-sup-04', law: 'yakkihou', pattern: '(疲労回復|不眠が改善|肩こりが治る)', isRegex: true,
    categories: INGESTIBLE, severity: 'block',
    reason: '症状の改善・回復の標ぼうは医薬品的効能。',
    suggestion: '「毎日を元気に過ごしたい方へ」等、効果の断定を避けた表現にする。',
  },
  {
    id: 'yk-sup-05', law: 'yakkihou', pattern: '(医薬品|薬のような|薬並み)', isRegex: true,
    categories: INGESTIBLE, severity: 'block',
    reason: '医薬品と誤認させる表現。',
    suggestion: '食品であることを明示し、医薬品との比較・類似の示唆を削除する。',
  },

  // ============ 薬機法: 広告基準（推薦・体験談・最大級） ============
  {
    id: 'yk-adv-01', law: 'yakkihou', pattern: '(医師が推奨|医師も推薦|専門医が認めた|クリニック監修)', isRegex: true,
    categories: 'all', severity: 'block',
    reason: '医薬関係者による推薦は医薬品等適正広告基準で禁止（効能効果の保証にあたる）。',
    suggestion: '推薦表現を削除する。監修者名の記載は事実の範囲にとどめ、効果の保証と読める文脈を避ける。',
  },
  {
    id: 'yk-adv-02', law: 'yakkihou', pattern: '(厚生労働省承認|国が認めた|国認可)', isRegex: true,
    categories: 'all', severity: 'block',
    reason: '公的機関のお墨付きを示唆する表現。承認の事実があっても広告での強調は不可。',
    suggestion: '削除する。医薬部外品であれば「医薬部外品」の表示にとどめる。',
  },
  {
    id: 'yk-adv-03', law: 'yakkihou', pattern: '(体験談|お客様の声).{0,40}(効果|改善|治っ)', isRegex: true,
    categories: 'all', severity: 'warn',
    reason: '体験談による効能効果の保証は広告基準違反。「個人の感想です」の打消しだけでは適法化されない。',
    suggestion: '効能効果に言及しない使用感の記述に限定する。',
  },
  {
    id: 'yk-adv-04', law: 'yakkihou', pattern: '(日本一|世界一|最高峰|業界最高|No1|ナンバー1)', isRegex: true,
    categories: 'all', severity: 'block',
    reason: '最大級表現は医薬品等適正広告基準で禁止。景表法上も合理的根拠が必要。',
    suggestion: '最大級表現を削除するか、調査主体・期間・対象を明記した客観的事実に置き換える。',
  },
  {
    id: 'yk-adv-05', law: 'yakkihou', pattern: '(ビフォーアフター|使用前使用後)', isRegex: true,
    categories: COSMETIC_LIKE, severity: 'warn',
    reason: '効果を保証する写真表現。加工・演出があると誇大広告に該当しうる。',
    suggestion: '同一条件・無加工であることを明示し、効能効果の範囲内に収める。',
  },

  // ============ 景表法: 優良誤認・有利誤認・ステマ ============
  {
    id: 'kh-01', law: 'keihyo', pattern: '(必ず|絶対に|100%|確実に)', isRegex: true,
    categories: 'all', severity: 'block',
    reason: '効果・結果の断定は合理的根拠がなければ優良誤認（景表法第5条第1号）。',
    suggestion: '断定を避け、根拠データがある場合は出典・条件を併記する。',
  },
  {
    id: 'kh-02', law: 'keihyo', pattern: '(顧客満足度no1|満足度no1|売上no1|シェアno1)', isRegex: true,
    categories: 'all', severity: 'warn',
    reason: 'No.1表示は調査主体・調査期間・調査対象・出典の明示が必要（No.1表示に関する実態調査報告書）。',
    suggestion: '「〇〇調べ／2026年1月／全国20〜49歳女性1,000名」等の調査概要を近接した位置に明記する。',
  },
  {
    id: 'kh-03', law: 'keihyo', pattern: '(通常価格|定価).{0,20}(→|から).{0,20}(円|%)', isRegex: true,
    categories: 'all', severity: 'warn',
    reason: '二重価格表示。比較対照価格には最近相当期間（8週間のうち4週間以上）の販売実績が必要。',
    suggestion: '販売実績のある価格のみを比較対照に用い、期間を明示する。',
  },
  {
    id: 'kh-04', law: 'keihyo', pattern: '(今だけ|本日限り|残りわずか|先着)', isRegex: true,
    categories: 'all', severity: 'info',
    reason: '限定性の強調は、実態が伴わない場合に有利誤認となる。',
    suggestion: '実際の期間・数量を明記し、恒常的な掲出を避ける。',
  },
  {
    id: 'kh-05', law: 'keihyo', pattern: '(返金保証|全額返金)', isRegex: true,
    categories: 'all', severity: 'warn',
    reason: '保証条件（期間・対象・手続き）の明示がないと有利誤認のおそれ。',
    suggestion: '適用条件・除外事項を同一画面内に明記する。',
  },
  {
    id: 'kh-06', law: 'keihyo', pattern: '(pr表記なし|ステマ)', isRegex: true,
    categories: 'all', severity: 'warn',
    reason: '事業者の表示であることを隠す行為は景表法の指定告示（いわゆるステマ規制）違反。',
    suggestion: '「PR」「広告」「プロモーション」等を、消費者が明瞭に認識できる位置・サイズで表示する。',
  },
  {
    id: 'kh-07', law: 'keihyo', pattern: '(実質無料|0円)', isRegex: true,
    categories: 'all', severity: 'info',
    reason: '「実質無料」は条件付き無料であることが多く、条件の明示を欠くと有利誤認。',
    suggestion: '無料となる条件・総支払額を明記する。',
  },
  {
    id: 'kh-08', law: 'keihyo', pattern: '(初回.{0,10}(無料|0円|半額))', isRegex: true,
    categories: 'all', severity: 'info',
    reason: '定期購入の初回価格訴求。総額・回数・解約条件の明示義務（特商法／景表法）がある。',
    suggestion: '「〇回継続が条件」「総額〇円」「解約は次回発送10日前まで」等を近接表示する。',
  },
];

/** そのカテゴリで当該エントリを適用すべきか */
export function appliesTo(entry: DictEntry, category: AdvertiserCategory): boolean {
  if (entry.allowedIn?.includes(category)) return false;
  if (entry.categories === 'all') return true;
  return entry.categories.includes(category);
}

export const CATEGORY_LABELS: Record<AdvertiserCategory, string> = {
  cosmetics: '化粧品',
  quasi_drug: '医薬部外品',
  drug: '医薬品',
  supplement: '健康食品・サプリメント',
  food_with_claims: '機能性表示食品・特定保健用食品',
  medical_device: '医療機器',
  general: '一般（薬機法対象外）',
};

import { config } from '../config/env.ts';
import { contracts } from '../db/repositories/finance.ts';
import { orgs } from '../db/repositories/orgs.ts';
import { projects } from '../db/repositories/projects.ts';
import { events } from '../db/repositories/system.ts';
import { formatJp, jstDateString, endOfMonth, addDays } from '../lib/date.ts';
import { formatYen } from '../lib/money.ts';
import { render } from '../lib/text.ts';
import { save, pathFor } from '../providers/storage/local.ts';
import type { Contract } from '../domain/types.ts';

/**
 * 契約書の自動生成。
 * ASP の三層構造（クライアント→代理店→メディア）それぞれの契約書式を持つ。
 * 生成物は Markdown（監査・差分管理しやすい）＋ HTML（配布用）で保存する。
 */

const MASTER_TEMPLATE = `# 広告制作・運用業務委託基本契約書

{{clientName}}（以下「甲」という。）と{{vendorName}}（以下「乙」という。）とは、甲が乙に委託する広告クリエイティブの制作および広告アカウント運用業務に関し、以下のとおり基本契約（以下「本契約」という。）を締結する。

## 第1条（目的）
本契約は、甲が乙に対して委託する次の各号の業務（以下「本業務」という。）に関する基本的事項を定めることを目的とする。
1. 動画広告、記事型ランディングページおよびランディングページの企画・制作
2. Meta 広告（Facebook / Instagram）を含む各広告媒体における広告アカウントの運用および効果測定
3. 前各号に付随関連する一切の業務

## 第2条（個別契約）
1. 本業務の具体的な内容、数量、委託料、納期その他の条件は、甲が発行する発注書および乙が発行する受注書（電磁的方法によるものを含む。）をもって成立する個別契約により定める。
2. 甲乙間で運用する業務管理システム上における発注登録および受注承諾の記録は、前項の発注書および受注書と同等の効力を有するものとする。
3. 本契約と個別契約の内容に齟齬がある場合は、個別契約の定めが優先する。

## 第3条（委託料および支払）
1. 本業務の委託料は個別契約に定めるところによる。
2. 乙は、{{closingDay}}を締日として当月分の委託料を集計し、甲に対し請求書を発行する。
3. 甲は、前項の請求書を受領した後、{{paymentTerms}}までに、乙の指定する銀行口座に振り込む方法により支払う。振込手数料は甲の負担とする。
4. 前項の請求書は、適格請求書等保存方式（インボイス制度）に適合した記載事項を備えるものとする。

## 第4条（成果物の検収）
1. 乙は、個別契約に定める納期までに成果物を甲に納入する。
2. 甲は、成果物の納入後{{inspectionDays}}日以内に検収を行い、合否を乙に通知する。当該期間内に通知がない場合、検収に合格したものとみなす。
3. 検収不合格の場合、甲は理由を明示して修正を求めることができ、乙は速やかに修正のうえ再納入する。

## 第5条（広告表現の適法性）
1. 乙は、本業務の遂行にあたり、医薬品、医療機器等の品質、有効性及び安全性の確保等に関する法律（薬機法）、不当景品類及び不当表示防止法（景品表示法）、特定商取引に関する法律その他関係法令および業界自主基準を遵守する。
2. 乙は、成果物の納入前に、前項の各法令に照らした表現審査を実施し、その記録を甲の求めに応じて開示する。
3. 甲は、甲が指定した表現、甲が提供した素材および甲が最終承認した表現に起因する法令違反について責任を負う。

## 第6条（知的財産権）
1. 成果物に関する著作権（著作権法第27条および第28条の権利を含む。）は、甲が委託料を完済した時点で乙から甲に移転する。ただし、乙が本業務以前から保有していた汎用的な技術、ノウハウおよびテンプレートに関する権利は乙に留保される。
2. 乙は、甲に対し、成果物に関する著作者人格権を行使しない。
3. 甲が乙に提供した素材（以下「提供素材」という。）に関する権利は甲に帰属する。乙は提供素材を本業務の目的の範囲内でのみ使用する。

## 第7条（生成AIの利用）
1. 乙は、本業務において生成AIを利用することがある。この場合、乙は、成果物の素材を、(a) 甲から提供された提供素材、および (b) 乙が生成AIにより生成した素材に限定し、第三者の権利を侵害する素材を使用しない。
2. 乙は、生成AIの利用にあたり、甲の秘密情報および提供素材が、当該生成AIの提供者による学習に利用されない設定または契約条件のもとで利用する。
3. 乙は、生成AIにより生成した素材について、生成に用いたプロンプト、モデル名および生成日時の記録を保持し、甲の求めに応じて開示する。

## 第8条（広告アカウントの取扱い）
1. 甲が乙に対して広告アカウントへのアクセス権限を付与する場合、乙は当該権限を本業務の目的の範囲内でのみ行使する。
2. 乙は、個別契約に定める予算上限および運用方針の範囲を超えて広告費を支出してはならない。
3. 乙は、広告アカウントにおける操作履歴を記録し、日次の運用報告書により甲に報告する。

## 第9条（秘密保持）
1. 甲および乙は、本契約に関連して相手方から開示された情報を秘密として保持し、事前の書面による承諾なく第三者に開示または漏洩してはならない。
2. 前項の義務は、本契約終了後{{ndaYears}}年間存続する。

## 第10条（個人情報の取扱い）
乙は、本業務に関して個人情報を取り扱う場合、個人情報の保護に関する法律を遵守し、甲の指示に従って適切に管理する。

## 第11条（再委託）
乙は、甲の事前の書面による承諾を得た場合に限り、本業務の全部または一部を第三者に再委託することができる。この場合、乙は再委託先の行為につき自ら行ったものとして責任を負う。

## 第12条（損害賠償）
甲または乙は、本契約に違反して相手方に損害を与えた場合、その損害を賠償する。ただし、乙が甲に対して負う損害賠償の総額は、当該損害の原因となった個別契約に基づく委託料の額を上限とする（乙の故意または重過失による場合を除く）。

## 第13条（有効期間）
本契約の有効期間は{{effectiveDate}}から1年間とする。期間満了の1か月前までに甲乙いずれからも書面による申出がないときは、同一条件でさらに1年間更新されるものとし、以後も同様とする。

## 第14条（解除）
甲または乙は、相手方に次の各号のいずれかの事由が生じた場合、催告なく本契約の全部または一部を解除することができる。
1. 本契約に違反し、相当期間を定めた催告後も是正されないとき
2. 支払停止、破産手続開始、民事再生手続開始等の申立てがあったとき
3. 差押え、仮差押え、租税滞納処分を受けたとき

## 第15条（反社会的勢力の排除）
甲および乙は、自己または自己の役員が反社会的勢力に該当しないことを表明し、将来にわたって該当しないことを確約する。相手方がこれに違反した場合、催告なく本契約を解除することができる。

## 第16条（協議）
本契約に定めのない事項または本契約の解釈に疑義が生じた事項については、甲乙誠意をもって協議のうえ解決する。

## 第17条（管轄）
本契約に関する紛争については、{{jurisdiction}}を第一審の専属的合意管轄裁判所とする。

---

本契約の成立を証するため、本書2通を作成し、甲乙記名押印のうえ各1通を保有する。

{{contractDate}}

**甲**　{{clientAddress}}
　　　{{clientName}}
　　　　　　　　　　　　　　　　　　　　　　　　　印

**乙**　{{vendorAddress}}
　　　{{vendorName}}
　　　　　　　　　　　　　　　　　　　　　　　　　印
`;

const INDIVIDUAL_TEMPLATE = `# 発注書（個別契約）

発注番号: {{orderNo}}
発行日: {{contractDate}}

{{vendorName}} 御中

{{clientName}}（{{clientAddress}}）は、{{masterRef}}に基づき、下記のとおり業務を発注します。

| 項目 | 内容 |
| --- | --- |
| 件名 | {{title}} |
| 業務内容 | {{scope}} |
| 数量 | {{quantity}} |
| 納期 | {{dueDate}} |
| 委託料（税抜） | {{amount}} |
| 消費税等 | {{tax}} |
| 合計（税込） | {{total}} |
| 支払条件 | {{paymentTerms}} |
| 検収期間 | 納入後 {{inspectionDays}} 日以内 |

## 特記事項
{{notes}}

## 素材の取扱い
本業務における映像・画像素材は、発注者が提供した素材および受注者が生成AIにより生成した素材に限るものとし、第三者が権利を有するストック素材等は使用しない。

## 広告表現
受注者は、納品前に薬機法・景品表示法に基づく表現審査を実施し、審査記録を成果物とともに提出する。

---
発注者: {{clientName}}　　　　　　　　受注者: {{vendorName}}
`;

const NDA_TEMPLATE = `# 秘密保持契約書

{{clientName}}（以下「甲」という。）と{{vendorName}}（以下「乙」という。）とは、{{purpose}}（以下「本目的」という。）に関し、以下のとおり秘密保持契約を締結する。

## 第1条（秘密情報）
本契約において「秘密情報」とは、本目的に関連して一方当事者が相手方に開示した技術上、営業上その他一切の情報であって、開示の際に秘密である旨が明示されたもの、または当該情報の性質上秘密として取り扱うことが合理的であるものをいう。ただし、次の各号のいずれかに該当する情報は秘密情報に含まれない。
1. 開示の時点で既に公知であった情報
2. 開示後、受領者の責によらず公知となった情報
3. 開示の時点で受領者が既に保有していた情報
4. 受領者が第三者から秘密保持義務を負うことなく適法に取得した情報
5. 受領者が秘密情報によらず独自に開発した情報

## 第2条（秘密保持義務）
1. 受領者は、秘密情報を厳に秘密として保持し、開示者の事前の書面による承諾なく第三者に開示または漏洩してはならない。
2. 受領者は、秘密情報を本目的以外の目的で使用してはならない。
3. 受領者は、本目的の遂行に必要な範囲で、自己の役員および従業員に限り秘密情報を開示することができる。この場合、受領者は当該役員および従業員に本契約と同等の義務を課す。

## 第3条（生成AIへの入力の制限）
受領者は、秘密情報を、当該情報が学習に利用される可能性のある生成AIサービスに入力してはならない。学習に利用されないことが契約上担保されたサービスに限り、本目的の範囲内で入力することができる。

## 第4条（複製の制限）
受領者は、本目的の遂行に必要な範囲を超えて秘密情報を複製してはならない。

## 第5条（返還・破棄）
受領者は、本契約が終了したとき、または開示者の請求があったときは、遅滞なく秘密情報およびその複製物を返還または破棄する。

## 第6条（有効期間）
本契約の有効期間は{{effectiveDate}}から{{ndaYears}}年間とする。本契約終了後も、第2条の義務は終了日からさらに{{ndaYears}}年間存続する。

## 第7条（管轄）
本契約に関する紛争については、{{jurisdiction}}を第一審の専属的合意管轄裁判所とする。

{{contractDate}}

**甲**　{{clientName}}　　　　　　　　　　　　　印
**乙**　{{vendorName}}　　　　　　　　　　　　　印
`;

const MEDIA_PARTNER_TEMPLATE = `# メディアパートナー業務委託契約書（成果報酬型）

{{clientName}}（以下「委託者」という。）と{{vendorName}}（以下「メディア」という。）とは、以下のとおり契約を締結する。

## 第1条（業務内容）
メディアは、委託者の指定する広告主の商材につき、クリエイティブの制作および広告配信を行い、成果（コンバージョン）を発生させる業務を行う。

## 第2条（報酬）
1. 報酬は、承認された成果1件あたり{{unitPrice}}とする。
2. 成果の承認は、委託者および広告主による確認（不正・重複・キャンセルの除外）を経て確定する。
3. 確定した成果件数は、業務管理システム上の集計をもって確定値とする。

## 第3条（広告表現の遵守）
1. メディアは、広告主が承認したクリエイティブおよび表現のみを使用する。
2. メディアは、薬機法・景品表示法に違反する表現を使用してはならない。違反により委託者または広告主に損害が生じた場合、メディアがこれを賠償する。
3. 委託者は、メディアの広告表現につき、いつでも修正または停止を求めることができ、メディアは直ちにこれに従う。

## 第4条（禁止行為）
メディアは、次の各号の行為を行ってはならない。
1. 自己または関係者による成果の作出（自己申込・不正申込）
2. リスティング広告における広告主の商標の無断使用
3. 虚偽の体験談、実在しない人物・団体の使用
4. 委託者の承認を得ない第三者への再委託

## 第5条（支払）
委託者は、{{closingDay}}締めで確定した報酬を、{{paymentTerms}}までにメディアの指定口座に支払う。

## 第6条（有効期間）
本契約の有効期間は{{effectiveDate}}から1年間とし、期間満了の1か月前までに申出がないときは同一条件で更新される。

{{contractDate}}

**委託者**　{{clientName}}　　　　　　　　印
**メディア**　{{vendorName}}　　　　　　　印
`;

const TEMPLATES = {
  master: MASTER_TEMPLATE,
  individual: INDIVIDUAL_TEMPLATE,
  nda: NDA_TEMPLATE,
  media_partner: MEDIA_PARTNER_TEMPLATE,
} as const;

export type ContractKind = keyof typeof TEMPLATES;

export type GenerateContractInput = {
  kind: ContractKind;
  fromOrgId: string;   // 委託者（甲）
  toOrgId: string;     // 受託者（乙）
  projectId?: string;
  title?: string;
  effectiveDate?: string;
  variables?: Record<string, string | number>;
};

export function generateContract(input: GenerateContractInput): Contract {
  const from = orgs.require(input.fromOrgId);
  const to = orgs.require(input.toOrgId);
  const project = input.projectId ? projects.find(input.projectId) : undefined;
  const today = jstDateString();

  const vars: Record<string, string | number> = {
    clientName: from.legal_name ?? from.name,
    clientAddress: from.address ?? '',
    vendorName: to.legal_name ?? to.name,
    vendorAddress: to.address ?? '',
    contractDate: formatJp(input.effectiveDate ?? today),
    effectiveDate: formatJp(input.effectiveDate ?? today),
    closingDay: from.closing_day >= 31 ? '月末' : `毎月${from.closing_day}日`,
    paymentTerms: from.payment_terms,
    inspectionDays: 5,
    ndaYears: 3,
    jurisdiction: '東京地方裁判所',
    purpose: project ? `${project.name}に関する検討および業務遂行` : '広告制作・運用業務に関する検討',
    masterRef: '広告制作・運用業務委託基本契約書',
    unitPrice: project ? formatYen(project.media_unit_price) : formatYen(0),
    orderNo: `PO-${today.replace(/-/g, '')}-0001`,
    title: input.title ?? project?.name ?? '広告制作・運用業務',
    scope: '動画広告／記事LP／LP の制作および Meta 広告運用',
    quantity: '1式',
    dueDate: formatJp(addDays(today, 14)),
    amount: formatYen(0),
    tax: formatYen(0),
    total: formatYen(0),
    notes: 'なし',
    ...input.variables,
  };

  const bodyMd = render(TEMPLATES[input.kind], vars);
  const titles: Record<ContractKind, string> = {
    master: '広告制作・運用業務委託基本契約書',
    individual: `発注書（個別契約） ${vars['title']}`,
    nda: '秘密保持契約書',
    media_partner: 'メディアパートナー業務委託契約書',
  };
  const title = input.title ?? titles[input.kind];

  const contract = contracts.create({
    project_id: input.projectId ?? null,
    kind: input.kind,
    title,
    from_org_id: from.id,
    to_org_id: to.id,
    body_md: bodyMd,
    variables: JSON.stringify(vars),
    status: 'draft',
    effective_date: input.effectiveDate ?? today,
    expire_date: input.kind === 'individual' ? null : endOfMonth(addDays(today, 365)),
  });

  const stored = save(
    pathFor({ projectId: input.projectId ?? 'common', kind: 'contracts', name: `${contract.id}.md` }),
    bodyMd,
  );
  save(
    pathFor({ projectId: input.projectId ?? 'common', kind: 'contracts', name: `${contract.id}.html` }),
    contractHtml(title, bodyMd),
  );
  contracts.update(contract.id, { storage_path: stored.path });

  events.log('system', 'contract.generated', 'contract', contract.id, { kind: input.kind, title });
  return contracts.require(contract.id);
}

/** Markdown を配布用 HTML に整形（依存ライブラリなしの最小変換） */
export function contractHtml(title: string, markdown: string): string {
  const body = markdown
    .split('\n')
    .map((line) => {
      if (/^### /.test(line)) return `<h3>${line.slice(4)}</h3>`;
      if (/^## /.test(line)) return `<h2>${line.slice(3)}</h2>`;
      if (/^# /.test(line)) return `<h1>${line.slice(2)}</h1>`;
      if (/^---\s*$/.test(line)) return '<hr>';
      if (/^\|/.test(line)) return line; // 表は後段でまとめて処理
      if (/^\d+\. /.test(line)) return `<li>${line.replace(/^\d+\.\s*/, '')}</li>`;
      if (line.trim() === '') return '';
      return `<p>${line}</p>`;
    })
    .join('\n')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(<li>[\s\S]*?<\/li>\n?)+/g, (m) => `<ol>${m}</ol>`);

  const tableRows = markdown.match(/^\|.*$/gm) ?? [];
  const table = tableRows.length
    ? `<table>${tableRows
        .filter((r) => !/^\|\s*-+/.test(r))
        .map((r, i) => {
          const cells = r.split('|').slice(1, -1).map((c) => c.trim());
          const tag = i === 0 ? 'th' : 'td';
          return `<tr>${cells.map((c) => `<${tag}>${c}</${tag}>`).join('')}</tr>`;
        })
        .join('')}</table>`
    : '';

  return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<title>${title}</title>
<style>
 body{font-family:"Hiragino Kaku Gothic ProN","Yu Gothic",sans-serif;line-height:1.9;max-width:820px;margin:40px auto;padding:0 24px;color:#1a1a1a}
 h1{font-size:22px;border-bottom:2px solid #333;padding-bottom:12px}
 h2{font-size:16px;margin-top:28px;border-left:4px solid #333;padding-left:10px}
 p{margin:8px 0}
 ol{padding-left:1.4em}
 table{border-collapse:collapse;width:100%;margin:16px 0}
 th,td{border:1px solid #ccc;padding:8px 12px;text-align:left;font-size:14px}
 th{background:#f5f5f5;width:30%}
 hr{border:none;border-top:1px solid #ccc;margin:32px 0}
 .footer{margin-top:40px;font-size:12px;color:#666}
</style></head><body>
${body.replace(/^\|.*$/gm, '')}
${table}
<div class="footer">${config.company.name} — 本書はシステムにより自動生成されました。締結前に法務確認を行ってください。</div>
</body></html>`;
}

export const CONTRACT_KINDS: ContractKind[] = ['master', 'individual', 'nda', 'media_partner'];

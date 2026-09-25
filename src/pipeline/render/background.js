// アイキャッチ背景の画像生成（任意）。.env の IMAGE_API_PROVIDER が設定されている時だけ使う。
// 文字は必ずテンプレート側で描くので、背景には文字・ロゴ・人物を入れないよう指示する。

export async function generateBackground({ config, prompt, cost, log }) {
  if (!config.image.provider || !prompt) return null;
  if (config.image.provider !== 'openai') {
    log(`⚠ IMAGE_API_PROVIDER=${config.image.provider} には対応していません（openai のみ）。背景画像なしで作ります`);
    return null;
  }
  cost.ensureBudget('アイキャッチ背景', config.image.pricePerImage);
  log(`▶ アイキャッチ背景  ${config.image.model}`);
  try {
    const { generateImageOpenAI } = await import('../providers/openai.js');
    const png = await generateImageOpenAI({
      model: config.image.model,
      prompt: `${prompt}. Abstract background only. No text, no letters, no numbers, no logos, no people, no characters.`,
    });
    cost.recordFixed('アイキャッチ背景', config.image.pricePerImage);
    return `data:image/png;base64,${png.toString('base64')}`;
  } catch (e) {
    log(`   ⚠ 背景画像を作れませんでした（${e.message}）。背景画像なしで作ります`);
    return null;
  }
}

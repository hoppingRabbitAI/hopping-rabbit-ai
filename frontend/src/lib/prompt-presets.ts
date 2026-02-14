/**
 * AI 能力预设 Prompt 库
 *
 * 每个能力提供 5-10 条精选 prompt：
 *   - label: 中文标签，展示给用户
 *   - prompt: 英文正向 prompt，发给 AI 模型
 *   - negativePrompt?: 英文反向 prompt（可选）
 */

export interface PromptPreset {
  label: string;
  prompt: string;
  negativePrompt?: string;
}

export type CapabilityPresets = Record<string, PromptPreset[]>;

export const PROMPT_PRESETS: CapabilityPresets = {
  // ──────────────────────────────────────
  // 图像生成
  // ──────────────────────────────────────
  omni_image: [
    {
      label: '时尚杂志封面',
      prompt: 'High-end fashion magazine cover, professional studio lighting, elegant pose, clean white background, 8K ultra-detailed, editorial photography style',
      negativePrompt: 'blurry, low quality, deformed, bad anatomy, watermark, text',
    },
    {
      label: '街拍写真',
      prompt: 'Urban street style photography, natural daylight, candid pose, shallow depth of field, bokeh background, cinematic color grading',
      negativePrompt: 'overexposed, underexposed, blurry, distorted, artificial looking',
    },
    {
      label: '法式优雅',
      prompt: 'French elegant fashion portrait, soft golden hour lighting, Parisian cafe background, romantic atmosphere, film grain texture, Vogue editorial style',
      negativePrompt: 'harsh lighting, oversaturated, cartoon, anime, low resolution',
    },
    {
      label: '赛博朋克风',
      prompt: 'Cyberpunk fashion portrait, neon lights, futuristic outfit, rain-soaked city street, holographic reflections, dramatic contrast, sci-fi aesthetic',
      negativePrompt: 'daylight, natural setting, blurry, low quality, deformed hands',
    },
    {
      label: '极简白底产品图',
      prompt: 'Clean product photography on pure white background, soft even lighting, no shadows, sharp focus, commercial catalog style, high resolution',
      negativePrompt: 'colored background, shadows, reflections, text, watermark',
    },
    {
      label: '复古胶片风',
      prompt: 'Vintage film photography style, warm color palette, soft focus, light leaks, 35mm film grain, retro fashion editorial, nostalgic atmosphere',
      negativePrompt: 'digital look, sharp, modern style, oversaturated, HDR',
    },
    {
      label: '户外自然光',
      prompt: 'Outdoor natural light fashion photography, golden hour backlight, lush green nature background, relaxed casual pose, lifestyle editorial',
      negativePrompt: 'studio, artificial lighting, dark, indoor, harsh shadows',
    },
    {
      label: '高级感黑白',
      prompt: 'High-fashion black and white portrait, dramatic chiaroscuro lighting, strong contrast, minimalist composition, timeless elegance, monochrome editorial',
      negativePrompt: 'color, low contrast, flat lighting, blurry, noise',
    },
  ],

  // ──────────────────────────────────────
  // 文生视频
  // ──────────────────────────────────────
  text_to_video: [
    {
      label: '时装秀走秀',
      prompt: 'Fashion runway show, model walking confidently down the catwalk, dramatic spotlights, audience in background, slow motion, cinematic camera movement',
      negativePrompt: 'static, blurry, low quality, distorted face, bad anatomy',
    },
    {
      label: '街头穿搭展示',
      prompt: 'Street style fashion showcase, model walking through urban city, natural daylight, smooth camera tracking shot, dynamic angles, lifestyle vlog aesthetic',
      negativePrompt: 'static camera, indoor, blurry, distorted, low resolution',
    },
    {
      label: '产品 360° 展示',
      prompt: 'Product 360 degree rotating showcase, clean white studio background, even soft lighting, smooth rotation, professional product video',
      negativePrompt: 'shaky, blurry, colored background, fast motion, distorted',
    },
    {
      label: '优雅慢动作',
      prompt: 'Elegant slow motion fashion video, flowing fabric in wind, soft golden hour lighting, dreamy atmosphere, cinematic depth of field',
      negativePrompt: 'fast motion, shaky camera, harsh lighting, low quality',
    },
    {
      label: '动态穿搭变装',
      prompt: 'Dynamic outfit transition video, smooth wardrobe change effect, energetic movement, modern music video style, creative transitions',
      negativePrompt: 'static, boring, low energy, blurry transitions, bad quality',
    },
  ],

  // ──────────────────────────────────────
  // 图生视频
  // ──────────────────────────────────────
  image_to_video: [
    {
      label: '微风拂动',
      prompt: 'Gentle breeze blowing through hair and clothing, subtle natural movement, soft ambient motion, cinematic atmosphere',
      negativePrompt: 'static, sudden movement, distorted, morphing, unnatural',
    },
    {
      label: '缓慢转头微笑',
      prompt: 'Slowly turning head with a gentle smile, natural facial expression, smooth subtle movement, portrait video',
      negativePrompt: 'fast movement, exaggerated expression, distorted face, glitch',
    },
    {
      label: '走路前行',
      prompt: 'Walking forward with confident stride, natural body movement, steady pace, fashion editorial video style',
      negativePrompt: 'static, floating, unnatural movement, distorted limbs',
    },
    {
      label: '镜头缓慢推进',
      prompt: 'Slow camera dolly in, gradually revealing details, cinematic zoom, smooth steady movement, professional cinematography',
      negativePrompt: 'fast zoom, shaky, jerky movement, distorted, blurry',
    },
    {
      label: '环境光影变化',
      prompt: 'Subtle ambient lighting shift, gentle shadow movement, atmospheric mood change, time-lapse style lighting transition',
      negativePrompt: 'sudden change, flickering, strobe, distorted, morphing',
    },
  ],

  // ──────────────────────────────────────
  // 多图生视频
  // ──────────────────────────────────────
  multi_image_to_video: [
    {
      label: '丝滑穿搭切换',
      prompt: 'Smooth outfit transition between frames, seamless wardrobe change, fluid morphing effect, fashion lookbook video',
      negativePrompt: 'abrupt cut, glitch, distorted, blurry transition',
    },
    {
      label: '场景渐变转场',
      prompt: 'Cinematic scene transition, smooth dissolve between environments, atmospheric mood shift, professional video editing style',
      negativePrompt: 'hard cut, jarring, flickering, low quality',
    },
    {
      label: '风格渐变',
      prompt: 'Gradual style transformation, smooth fashion evolution, seamless visual morphing between different aesthetics',
      negativePrompt: 'sudden jump, glitch, distorted features, unnatural',
    },
    {
      label: '四季穿搭',
      prompt: 'Seasonal fashion transition, spring to summer to autumn to winter wardrobe changes, natural environment shifts, lifestyle video',
      negativePrompt: 'static, abrupt changes, inconsistent person, distorted',
    },
    {
      label: '日夜转换',
      prompt: 'Day to night transition, changing ambient lighting, outfit change for different occasions, cinematic time-lapse feel',
      negativePrompt: 'sudden change, flickering lights, distorted, low quality',
    },
  ],

  // ──────────────────────────────────────
  // 动作控制
  // ──────────────────────────────────────
  motion_control: [
    {
      label: '自然行走',
      prompt: 'Natural walking motion, confident stride, relaxed arm swing, smooth locomotion, fashion model walk',
      negativePrompt: 'stiff, robotic, floating, unnatural gait',
    },
    {
      label: '转身回眸',
      prompt: 'Elegant turn and look back over shoulder, graceful rotation, slow deliberate movement, dramatic pose',
      negativePrompt: 'fast spin, distorted body, unnatural twist',
    },
    {
      label: '展示衣物细节',
      prompt: 'Showing clothing details, turning to display outfit from multiple angles, natural hand gestures highlighting fabric and design',
      negativePrompt: 'static, stiff pose, distorted hands, blurry',
    },
    {
      label: '舞蹈律动',
      prompt: 'Rhythmic dance movement, smooth body flow, graceful choreography, energetic yet controlled motion',
      negativePrompt: 'stiff, jerky, distorted limbs, uncoordinated',
    },
    {
      label: '坐下起立',
      prompt: 'Sitting down and standing up naturally, smooth transition, casual relaxed movement, lifestyle scene',
      negativePrompt: 'floating, clipping through furniture, unnatural physics',
    },
  ],

  // ──────────────────────────────────────
  // 视频延长
  // ──────────────────────────────────────
  video_extend: [
    {
      label: '自然延续',
      prompt: 'Continue the natural motion and scene seamlessly, maintain consistent lighting and style, smooth continuation',
      negativePrompt: 'abrupt change, style shift, flickering, distorted',
    },
    {
      label: '渐入尾声',
      prompt: 'Gradually slow down to a graceful ending, gentle deceleration, fade to subtle stillness, cinematic conclusion',
      negativePrompt: 'abrupt stop, sudden freeze, glitch, jarring',
    },
    {
      label: '镜头拉远',
      prompt: 'Camera slowly pulling back to reveal wider scene, gradual zoom out, establishing shot transition',
      negativePrompt: 'fast zoom, shaky, sudden movement, distorted',
    },
  ],

  // ──────────────────────────────────────
  // 口型同步
  // ──────────────────────────────────────
  lip_sync: [],

  // ──────────────────────────────────────
  // AI 换脸
  // ──────────────────────────────────────
  face_swap: [
    {
      label: '自然融合',
      prompt: 'Natural face blend, seamless skin tone matching, preserve original lighting and shadow, realistic integration',
      negativePrompt: 'visible seam, mismatched skin tone, uncanny valley, distorted features',
    },
    {
      label: '保留妆容风格',
      prompt: 'Face swap preserving makeup style of the target, maintain cosmetic details, natural skin texture, professional result',
      negativePrompt: 'blurry face, mismatched makeup, distorted features, low quality',
    },
    {
      label: '表情一致',
      prompt: 'Face swap with expression consistency, match the mood and emotion of the original scene, natural facial muscles',
      negativePrompt: 'mismatched expression, stiff face, uncanny, distorted',
    },
  ],

  // ──────────────────────────────────────
  // 皮肤美化
  // ──────────────────────────────────────
  skin_enhance: [
    {
      label: '自然美颜',
      prompt: 'Natural skin retouching, subtle smoothing while preserving skin texture, even skin tone, healthy glow, professional beauty retouch',
      negativePrompt: 'plastic skin, over-smoothed, blurry, wax-like, loss of texture',
    },
    {
      label: '杂志级精修',
      prompt: 'Magazine-quality skin retouching, flawless complexion, porcelain skin effect, even lighting, high-end beauty editorial',
      negativePrompt: 'natural imperfections, uneven skin, heavy texture, harsh',
    },
    {
      label: '清透水光肌',
      prompt: 'Dewy glass skin effect, luminous translucent complexion, subtle highlight on cheekbones, fresh hydrated look, K-beauty style',
      negativePrompt: 'matte, dry skin, oily, over-glossy, plastic',
    },
    {
      label: '健康小麦色',
      prompt: 'Healthy sun-kissed skin tone, warm golden undertone, natural bronze glow, outdoor lifestyle look',
      negativePrompt: 'pale, washed out, sunburn, uneven tan, orange',
    },
  ],

  // ──────────────────────────────────────
  // AI 打光
  // ──────────────────────────────────────
  relight: [
    {
      label: '金色夕阳',
      prompt: 'Golden hour warm sunset lighting, soft orange and amber tones, long shadows, romantic atmosphere, natural backlight rim',
      negativePrompt: 'cold tones, blue light, harsh shadows, flat lighting',
    },
    {
      label: '专业棚拍',
      prompt: 'Professional studio three-point lighting setup, key light with soft fill, clean rim light separation, even illumination, commercial photography',
      negativePrompt: 'harsh shadows, uneven lighting, natural light, dark',
    },
    {
      label: '霓虹都市',
      prompt: 'Neon city night lighting, colorful reflections on skin, cyberpunk atmosphere, blue and pink accent lights, urban night portrait',
      negativePrompt: 'daylight, natural, warm tones, soft lighting',
    },
    {
      label: '戏剧侧光',
      prompt: 'Dramatic side lighting, strong chiaroscuro contrast, moody atmosphere, one-light setup, fine art portrait style',
      negativePrompt: 'flat lighting, even illumination, no shadow, bright',
    },
    {
      label: '柔和窗光',
      prompt: 'Soft window natural light, gentle diffused illumination, subtle shadows, calm intimate atmosphere, lifestyle portrait',
      negativePrompt: 'harsh direct sunlight, strong shadows, artificial light, dark',
    },
    {
      label: '环形补光',
      prompt: 'Ring light beauty lighting, even frontal illumination, catchlight in eyes, smooth shadow-free complexion, beauty vlog style',
      negativePrompt: 'strong shadows, side lighting, dark, uneven',
    },
  ],

  // ──────────────────────────────────────
  // 换装
  // ──────────────────────────────────────
  outfit_swap: [
    {
      label: '自然贴合',
      prompt: 'Natural outfit fitting, seamless garment integration on body, realistic fabric draping and wrinkles, consistent lighting and shadows',
      negativePrompt: 'floating clothing, misaligned seams, distorted body, flat texture',
    },
    {
      label: '保持身材比例',
      prompt: 'Outfit swap preserving original body proportions and pose, accurate garment sizing, natural fit, professional lookbook result',
      negativePrompt: 'distorted body shape, wrong proportions, oversized, undersized',
    },
    {
      label: '面料质感还原',
      prompt: 'Preserve original fabric texture and material quality, realistic cloth simulation, detailed stitching and pattern, true-to-life garment rendering',
      negativePrompt: 'flat texture, plastic look, blurry fabric, loss of detail',
    },
  ],

  // ──────────────────────────────────────
  // AI 穿搭师
  // ──────────────────────────────────────
  ai_stylist: [
    {
      label: '法式慵懒',
      prompt: 'French effortless chic styling, neutral palette with one accent piece, relaxed silhouettes, quality basics, understated elegance',
      negativePrompt: 'overdressed, flashy, neon colors, sporty, casual streetwear',
    },
    {
      label: '都市通勤',
      prompt: 'Modern office-ready outfit, smart casual business style, tailored fit, neutral and earth tones, polished professional look',
      negativePrompt: 'casual pajamas, gym wear, overly formal tuxedo, costume',
    },
    {
      label: '韩系简约',
      prompt: 'Korean minimalist fashion, oversized layered silhouettes, muted color palette, clean lines, contemporary K-fashion aesthetic',
      negativePrompt: 'loud patterns, bright colors, tight fit, vintage, western cowboy',
    },
    {
      label: '街头潮流',
      prompt: 'Urban streetwear outfit, bold graphic elements, sneakers, layered accessories, hypebeast aesthetic, confident stance',
      negativePrompt: 'formal suit, conservative, plain, office wear, vintage',
    },
    {
      label: '度假休闲',
      prompt: 'Resort vacation outfit, light breathable fabrics, tropical-inspired colors, relaxed fit, summer holiday vibes, beach-ready style',
      negativePrompt: 'heavy winter clothes, dark colors, formal, office wear',
    },
    {
      label: '高级晚装',
      prompt: 'Elegant evening gown styling, luxurious fabric, sophisticated silhouette, statement jewelry, red carpet ready, glamorous aesthetic',
      negativePrompt: 'casual, sporty, daywear, sneakers, denim',
    },
  ],

  // ──────────────────────────────────────
  // AI 穿搭内容
  // ──────────────────────────────────────
  outfit_shot: [
    {
      label: '小红书爆款',
      prompt: 'Xiaohongshu viral fashion post style, bright natural lighting, lifestyle background, aesthetic composition, OOTD flat lay or mirror selfie style, engaging visual',
      negativePrompt: 'dark, studio, boring composition, low quality, text overlay',
    },
    {
      label: '抖音穿搭',
      prompt: 'Douyin fashion content style, dynamic angle, trendy outfit showcase, energetic mood, vibrant colors, young lifestyle aesthetic',
      negativePrompt: 'static, dull, dark lighting, old-fashioned, blurry',
    },
    {
      label: 'INS 博主风',
      prompt: 'Instagram fashion influencer style, curated aesthetic feed, warm color grading, lifestyle setting, aspirational visual storytelling',
      negativePrompt: 'messy background, unflattering angle, low resolution, cluttered',
    },
    {
      label: '电商白底图',
      prompt: 'E-commerce product photography, pure white background, full outfit display, clean even lighting, model showing garment details, catalog style',
      negativePrompt: 'colored background, artistic filter, lifestyle scene, blurry',
    },
    {
      label: '街拍大片',
      prompt: 'High-end street snap photography, urban cityscape background, fashion editorial angle, cinematic color grading, confident model pose',
      negativePrompt: 'studio, indoor, white background, boring pose, low quality',
    },
    {
      label: '平铺展示',
      prompt: 'Flat lay outfit arrangement, overhead bird-eye view, neatly organized garments and accessories on clean surface, aesthetic spacing, catalog style',
      negativePrompt: 'messy, wrinkled, on-body, side angle, cluttered background',
    },
  ],
};

/** 获取指定能力的预设列表（空数组如果无预设） */
export function getPresetsForCapability(capabilityId: string): PromptPreset[] {
  return PROMPT_PRESETS[capabilityId] || [];
}

import http from 'http';

function callRpc(method: string, params: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ method, params });
    const req = http.request('http://localhost:8082/rpc', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(JSON.parse(body)));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function tool(name: string, input: any) {
  return callRpc('agent.tool', { name, input });
}

async function applyAnimations() {
  console.log('=== Applying Comprehensive Motion & Animations via MCP ===');

  // 1. Плавний скрол на рівні сайту (Lenis)
  console.log('1. Enabling Lenis Smooth Scroll...');
  const smooth = await tool('set_smooth_scroll', {
    enabled: true,
    intensity: 14,
    smooth_touch: true,
  });
  console.log('Smooth scroll:', JSON.stringify(smooth?.result));

  // 2. Текстова анімація по літерах для H1
  console.log('2. Setting character-by-character reveal for H1...');
  const textH1 = await tool('set_text_effect', {
    node_id: 'hero-title',
    preset: 'Slide Up',
    split: 'character',
    stagger: 0.035,
    mask: true,
    trigger: 'appear',
    transition: {
      type: 'spring',
      stiffness: 320,
      damping: 28,
    },
  });
  console.log('H1 Text animation:', JSON.stringify(textH1?.result));

  // 3. Плавна поява (appear) для підзаголовка та кнопки hero
  console.log('3. Setting appear animations for Hero...');
  await tool('set_motion', {
    node_id: 'hero-subtitle',
    effect: 'appear',
    from: { opacity: 0, y: 25 },
    transition: { duration: 0.8, delay: 0.3, ease: 'easeOut' },
  });

  await tool('set_motion', {
    node_id: 'hero-btn',
    effect: 'hover',
    targets: { scale: 1.05, backgroundColor: 'rgba(255, 69, 0, 0.15)' },
  });

  // 4. Floating loop на сюрреалістичних руках
  console.log('4. Setting loop float for surrealist hands...');
  await tool('set_motion', {
    node_id: 'float-left',
    effect: 'loop',
    targets: { y: -20, rotate: 2 },
    transition: { duration: 10, ease: 'easeInOut' },
  });

  await tool('set_motion', {
    node_id: 'float-right',
    effect: 'loop',
    targets: { y: 20, rotate: -2 },
    transition: { duration: 12, ease: 'easeInOut' },
  });

  // 5. Selected Works: скрол-анімація карток (одна вгору, інша вниз)
  console.log('5. Setting scroll parallax for Works section cards (one up, one down)...');
  // Card 1 (помаранчева) рухається повільніше або відстає (ефект зсуву вниз)
  const card1Parallax = await tool('set_motion', {
    node_id: 'work-card-1',
    effect: 'speed',
    speed: 70, // lags behind as you scroll
  });
  console.log('Card 1 speed (parallax down):', JSON.stringify(card1Parallax?.result));

  // Card 2 (чорна) рухається швидше або підіймається назустріч скролу
  const card2Parallax = await tool('set_motion', {
    node_id: 'work-card-2',
    effect: 'speed',
    speed: 135, // moves faster as you scroll
  });
  console.log('Card 2 speed (parallax up):', JSON.stringify(card2Parallax?.result));

  // Hover ефекти для карток Works
  await tool('set_motion', {
    node_id: 'work-card-1',
    effect: 'hover',
    targets: { scale: 1.02, y: -6 },
  });
  await tool('set_motion', {
    node_id: 'work-card-2',
    effect: 'hover',
    targets: { scale: 1.02, y: -6 },
  });

  // 6. Expertise секція: плавна поява тексту при скролі (appear on scroll)
  console.log('6. Setting reveal effects for Expertise & Brands...');
  await tool('set_motion', {
    node_id: 'expertise-title',
    effect: 'appear',
    from: { opacity: 0, y: 35 },
    transition: { duration: 0.9, ease: 'easeOut' },
  });
  await tool('set_motion', {
    node_id: 'expertise-desc',
    effect: 'appear',
    from: { opacity: 0, y: 25 },
    transition: { duration: 0.9, delay: 0.2, ease: 'easeOut' },
  });
  await tool('set_motion', {
    node_id: 'brands-grid',
    effect: 'appear',
    from: { opacity: 0, y: 20 },
    transition: { duration: 1, delay: 0.3, ease: 'easeOut' },
  });

  // 7. Pricing секція: плавна поява блоку заголовка та інтерактивність
  console.log('7. Setting appear & hover effects for Pricing Section...');
  await tool('set_motion', {
    node_id: 'pricing-header-wrap',
    effect: 'appear',
    from: { opacity: 0, y: 40 },
    transition: { duration: 0.8, ease: 'easeOut' },
  });

  await tool('set_motion', {
    node_id: 'pricing-card-1',
    effect: 'appear',
    from: { opacity: 0, y: 50 },
    transition: { duration: 0.7, delay: 0.1, ease: 'easeOut' },
  });

  await tool('set_motion', {
    node_id: 'pricing-card-2',
    effect: 'appear',
    from: { opacity: 0, y: 50 },
    transition: { duration: 0.7, delay: 0.2, ease: 'easeOut' },
  });

  await tool('set_motion', {
    node_id: 'pricing-card-3',
    effect: 'appear',
    from: { opacity: 0, y: 50 },
    transition: { duration: 0.7, delay: 0.3, ease: 'easeOut' },
  });

  // Навігація CTA кнопка hover
  await tool('set_motion', {
    node_id: 'nav-cta',
    effect: 'hover',
    targets: { scale: 1.05 },
  });

  console.log('=== ALL ANIMATIONS APPLIED SUCCESSFULLY VIA MCP! ===');
}

applyAnimations().catch((err) => {
  console.error('Error applying animations:', err);
  process.exit(1);
});

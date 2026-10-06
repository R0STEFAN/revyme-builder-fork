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

async function buildPricing() {
  console.log('=== Adding Pricing Section via MCP Semantic Agent Tools ===');

  // 1. Header Frame inside pricing-section
  console.log('1. Adding header container...');
  await tool('add_node', {
    parent_id: 'pricing-section',
    tag: 'div',
    id: 'pricing-header-wrap',
    styles: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      marginBottom: '72px',
      gap: '16px',
    },
  });

  // Eyebrow
  await tool('add_node', {
    parent_id: 'pricing-header-wrap',
    tag: 'p',
    id: 'pricing-eyebrow-text',
    text: 'PRICING & MEMBERSHIPS',
    styles: {
      fontSize: '12px',
      letterSpacing: '0.2em',
      color: '#FF4500',
      fontWeight: '600',
      textAlign: 'center',
    },
  });

  // Title
  await tool('add_node', {
    parent_id: 'pricing-header-wrap',
    tag: 'h2',
    id: 'pricing-title-text',
    text: 'Choose your level of impact',
    styles: {
      fontSize: '56px',
      color: '#ffffff',
      textAlign: 'center',
    },
  });

  // Subtitle
  await tool('add_node', {
    parent_id: 'pricing-header-wrap',
    tag: 'p',
    id: 'pricing-subtitle-text',
    text: 'Select a tier crafted to transform your presence into an enduring digital landmark.',
    styles: {
      fontSize: '18px',
      color: '#71717a',
      maxWidth: '580px',
      textAlign: 'center',
      lineHeight: '1.6',
    },
  });

  // 2. Pricing Cards Grid Container
  console.log('2. Adding cards grid...');
  await tool('add_node', {
    parent_id: 'pricing-section',
    tag: 'div',
    id: 'pricing-cards-grid',
    styles: {
      display: 'flex',
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      gap: '32px',
      maxWidth: '1200px',
      margin: '0 auto',
      width: '100%',
    },
  });

  // ─── CARD 1: ESSENTIAL ───
  console.log('3. Adding Card 1 (Essential)...');
  await tool('add_node', {
    parent_id: 'pricing-cards-grid',
    tag: 'div',
    id: 'pricing-card-1',
    styles: {
      backgroundColor: '#111111',
      border: '1px solid rgba(255, 255, 255, 0.08)',
      borderRadius: '24px',
      padding: '40px',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      width: '360px',
      minHeight: '480px',
    },
  });
  await tool('add_node', {
    parent_id: 'pricing-card-1',
    tag: 'p',
    id: 'card-1-tier',
    text: 'ESSENTIAL',
    styles: { fontSize: '13px', letterSpacing: '0.15em', color: '#a1a1aa', fontWeight: '600' },
  });
  await tool('add_node', {
    parent_id: 'pricing-card-1',
    tag: 'h3',
    id: 'card-1-price',
    text: '$3,200',
    styles: { fontSize: '48px', color: '#ffffff', margin: '16px 0 8px 0' },
  });
  await tool('add_node', {
    parent_id: 'pricing-card-1',
    tag: 'p',
    id: 'card-1-desc',
    text: 'A bespoke high-conversion launchpad for creators and boutique studios.',
    styles: { fontSize: '14px', color: '#a1a1aa', lineHeight: '1.6', marginBottom: '24px' },
  });
  await tool('add_node', {
    parent_id: 'pricing-card-1',
    tag: 'div',
    id: 'card-1-btn',
    text: 'Select Essential',
    styles: {
      padding: '14px 24px',
      borderRadius: '9999px',
      border: '1px solid rgba(255, 255, 255, 0.15)',
      color: '#ffffff',
      fontSize: '14px',
      fontWeight: '500',
      backgroundColor: 'rgba(255, 255, 255, 0.03)',
      textAlign: 'center',
      cursor: 'pointer',
      marginTop: 'auto',
    },
  });

  // ─── CARD 2: SIGNATURE (ГОЛОВНА КАРТКА) ───
  console.log('4. Adding Card 2 (Signature - Featured)...');
  await tool('add_node', {
    parent_id: 'pricing-cards-grid',
    tag: 'div',
    id: 'pricing-card-2',
    styles: {
      backgroundColor: '#171717',
      border: '2px solid #FF4500',
      borderRadius: '24px',
      padding: '48px 40px',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      width: '380px',
      minHeight: '520px',
      boxShadow: '0 20px 50px rgba(255, 69, 0, 0.25)',
      position: 'relative',
    },
  });
  // Badge
  await tool('add_node', {
    parent_id: 'pricing-card-2',
    tag: 'p',
    id: 'card-2-badge',
    text: 'FEATURED & POPULAR',
    styles: {
      position: 'absolute',
      top: '-14px',
      left: '40px',
      backgroundColor: '#FF4500',
      color: '#000000',
      fontSize: '11px',
      fontWeight: '700',
      letterSpacing: '0.15em',
      padding: '6px 16px',
      borderRadius: '9999px',
    },
  });
  await tool('add_node', {
    parent_id: 'pricing-card-2',
    tag: 'p',
    id: 'card-2-tier',
    text: 'SIGNATURE PRO',
    styles: { fontSize: '13px', letterSpacing: '0.15em', color: '#FF4500', fontWeight: '700' },
  });
  await tool('add_node', {
    parent_id: 'pricing-card-2',
    tag: 'h3',
    id: 'card-2-price',
    text: '$6,500',
    styles: { fontSize: '56px', color: '#ffffff', margin: '16px 0 8px 0' },
  });
  await tool('add_node', {
    parent_id: 'pricing-card-2',
    tag: 'p',
    id: 'card-2-desc',
    text: 'Our flagship engagement. A comprehensive brand ecosystem with kinetic motion and dynamic CMS.',
    styles: { fontSize: '14px', color: '#e4e4e7', lineHeight: '1.6', marginBottom: '24px' },
  });
  await tool('add_node', {
    parent_id: 'pricing-card-2',
    tag: 'div',
    id: 'card-2-btn',
    text: 'Commission Signature',
    styles: {
      padding: '16px 24px',
      borderRadius: '9999px',
      backgroundColor: '#FF4500',
      color: '#000000',
      fontSize: '14px',
      fontWeight: '600',
      textAlign: 'center',
      cursor: 'pointer',
      boxShadow: '0 10px 25px rgba(255, 69, 0, 0.4)',
      marginTop: 'auto',
    },
  });

  // ─── CARD 3: PRESTIGE ───
  console.log('5. Adding Card 3 (Prestige)...');
  await tool('add_node', {
    parent_id: 'pricing-cards-grid',
    tag: 'div',
    id: 'pricing-card-3',
    styles: {
      backgroundColor: '#111111',
      border: '1px solid rgba(255, 255, 255, 0.08)',
      borderRadius: '24px',
      padding: '40px',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      width: '360px',
      minHeight: '480px',
    },
  });
  await tool('add_node', {
    parent_id: 'pricing-card-3',
    tag: 'p',
    id: 'card-3-tier',
    text: 'PRESTIGE',
    styles: { fontSize: '13px', letterSpacing: '0.15em', color: '#a1a1aa', fontWeight: '600' },
  });
  await tool('add_node', {
    parent_id: 'pricing-card-3',
    tag: 'h3',
    id: 'card-3-price',
    text: '$14,000+',
    styles: { fontSize: '48px', color: '#ffffff', margin: '16px 0 8px 0' },
  });
  await tool('add_node', {
    parent_id: 'pricing-card-3',
    tag: 'p',
    id: 'card-3-desc',
    text: 'Unrestricted creative direction, dedicated engineering, WebGL shaders and full internationalization.',
    styles: { fontSize: '14px', color: '#a1a1aa', lineHeight: '1.6', marginBottom: '24px' },
  });
  await tool('add_node', {
    parent_id: 'pricing-card-3',
    tag: 'div',
    id: 'card-3-btn',
    text: 'Inquire Enterprise',
    styles: {
      padding: '14px 24px',
      borderRadius: '9999px',
      border: '1px solid rgba(255, 255, 255, 0.15)',
      color: '#ffffff',
      fontSize: '14px',
      fontWeight: '500',
      backgroundColor: 'rgba(255, 255, 255, 0.03)',
      textAlign: 'center',
      cursor: 'pointer',
      marginTop: 'auto',
    },
  });

  // 6. Анімація на картках
  console.log('6. Adding hover motion...');
  await tool('set_motion', {
    node_id: 'pricing-card-2',
    effect: 'hover',
    targets: { y: -12, scale: 1.02 },
  });
  await tool('set_motion', {
    node_id: 'pricing-card-1',
    effect: 'hover',
    targets: { y: -8 },
  });
  await tool('set_motion', {
    node_id: 'pricing-card-3',
    effect: 'hover',
    targets: { y: -8 },
  });

  console.log('=== SUCCESS! Pricing section with 3 cards constructed live via MCP! ===');
}

buildPricing().catch(err => {
  console.error('Build error:', err);
  process.exit(1);
});

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
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(body));
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function run() {
  console.log('1. Reading current code via getContext...');
  const ctx = await callRpc('getContext', {});
  if (!ctx.ok) throw new Error(ctx.error);

  let code: string = ctx.result.code;
  console.log('Current active file:', ctx.result.activeFilePath);

  const pricingSection = `
      {/* ─── PRICING SECTION (Added via MCP) ─── */}
      <section data-id="pricing-section" style={{
        position: 'relative',
        padding: '120px 24px',
        backgroundColor: '#050505',
        overflow: 'hidden'
      }}>
        <div data-id="pricing-container" style={{ maxWidth: '1200px', margin: '0 auto' }}>
          
          <div data-id="pricing-header" style={{ textAlign: 'center', marginBottom: '72px' }}>
            <span data-id="pricing-eyebrow" style={{
              display: 'inline-block',
              fontSize: '12px',
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: '#FF4500',
              marginBottom: '16px',
              fontWeight: 600
            }}>
              Pricing & Memberships
            </span>
            <h2 data-id="pricing-heading" className="font-serif" style={{ fontSize: '56px', marginBottom: '20px', color: '#ffffff' }}>
              Designed for <span style={{ fontStyle: 'italic', fontWeight: 300, color: '#ffe0e0' }}>uncompromising vision</span>
            </h2>
            <p data-id="pricing-subheading" style={{ color: '#71717a', fontSize: '18px', maxWidth: '580px', margin: '0 auto', lineHeight: 1.6 }}>
              Select a tier crafted to transform your presence into an enduring digital landmark.
            </p>
          </div>

          <div data-id="pricing-grid" style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '32px',
            alignItems: 'stretch'
          }}>

            {/* Card 1: Essential */}
            <div data-id="pricing-card-1" style={{
              backgroundColor: '#111111',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '24px',
              padding: '40px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between'
            }}>
              <div>
                <span data-id="p1-title" style={{ fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.15em', color: '#a1a1aa', fontWeight: 600 }}>
                  Essential
                </span>
                <div data-id="p1-pricing" style={{ marginTop: '20px', marginBottom: '16px' }}>
                  <span className="font-serif" style={{ fontSize: '48px', fontWeight: 600, color: '#ffffff' }}>$3,200</span>
                  <span style={{ color: '#71717a', fontSize: '14px', marginLeft: '6px' }}>/ project</span>
                </div>
                <p data-id="p1-desc" style={{ color: '#a1a1aa', fontSize: '14px', lineHeight: 1.6, marginBottom: '32px' }}>
                  A bespoke high-conversion launchpad for creators, boutique studios, and ambitious products.
                </p>
                <div style={{ height: '1px', backgroundColor: 'rgba(255, 255, 255, 0.08)', marginBottom: '32px' }}></div>
                <ul data-id="p1-features" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <li style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '14px', color: '#e4e4e7' }}>
                    <span style={{ color: '#a1a1aa' }}>✓</span> 1 Curated Narrative Page
                  </li>
                  <li style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '14px', color: '#e4e4e7' }}>
                    <span style={{ color: '#a1a1aa' }}>✓</span> Framer Motion Interactions
                  </li>
                  <li style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '14px', color: '#e4e4e7' }}>
                    <span style={{ color: '#a1a1aa' }}>✓</span> Adaptive Responsive Layout
                  </li>
                </ul>
              </div>
              <a data-id="p1-button" href="#contact" style={{
                marginTop: '40px',
                display: 'block',
                textAlign: 'center',
                padding: '14px 24px',
                borderRadius: '9999px',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                color: '#ffffff',
                textDecoration: 'none',
                fontSize: '14px',
                fontWeight: 500,
                backgroundColor: 'rgba(255, 255, 255, 0.03)'
              }}>
                Select Essential
              </a>
            </div>

            {/* Card 2: Signature (ГОЛОВНА КАРТКА) */}
            <div data-id="pricing-card-2" style={{
              backgroundColor: '#171717',
              border: '2px solid #FF4500',
              borderRadius: '24px',
              padding: '48px 40px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              boxShadow: '0 20px 50px rgba(255, 69, 0, 0.3)',
              position: 'relative',
              transform: 'scale(1.05)',
              zIndex: 10
            }}>
              <div data-id="p2-badge" style={{
                position: 'absolute',
                top: '-15px',
                left: '50%',
                transform: 'translateX(-50%)',
                backgroundColor: '#FF4500',
                color: '#000000',
                fontSize: '11px',
                fontWeight: 700,
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                padding: '6px 18px',
                borderRadius: '9999px'
              }}>
                Featured
              </div>
              <div>
                <span data-id="p2-title" style={{ fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.15em', color: '#FF4500', fontWeight: 700 }}>
                  Signature
                </span>
                <div data-id="p2-pricing" style={{ marginTop: '20px', marginBottom: '16px' }}>
                  <span className="font-serif" style={{ fontSize: '56px', fontWeight: 600, color: '#ffffff' }}>$6,500</span>
                  <span style={{ color: '#a1a1aa', fontSize: '14px', marginLeft: '6px' }}>/ project</span>
                </div>
                <p data-id="p2-desc" style={{ color: '#d4d4d8', fontSize: '14px', lineHeight: 1.6, marginBottom: '32px' }}>
                  Our flagship engagement. A comprehensive brand ecosystem with immersive kinetic typography and CMS.
                </p>
                <div style={{ height: '1px', backgroundColor: 'rgba(255, 255, 255, 0.1)', marginBottom: '32px' }}></div>
                <ul data-id="p2-features" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <li style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '14px', color: '#ffffff' }}>
                    <span style={{ color: '#FF4500' }}>✓</span> Up to 5 Bespoke Pages
                  </li>
                  <li style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '14px', color: '#ffffff' }}>
                    <span style={{ color: '#FF4500' }}>✓</span> Full CMS Engine Integration
                  </li>
                  <li style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '14px', color: '#ffffff' }}>
                    <span style={{ color: '#FF4500' }}>✓</span> Custom Kinetic Animations & Shaders
                  </li>
                  <li style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '14px', color: '#ffffff' }}>
                    <span style={{ color: '#FF4500' }}>✓</span> Dedicated SEO & Performance Architecture
                  </li>
                </ul>
              </div>
              <a data-id="p2-button" href="#contact" style={{
                marginTop: '40px',
                display: 'block',
                textAlign: 'center',
                padding: '16px 24px',
                borderRadius: '9999px',
                backgroundColor: '#FF4500',
                color: '#000000',
                textDecoration: 'none',
                fontSize: '14px',
                fontWeight: 600,
                boxShadow: '0 10px 25px rgba(255, 69, 0, 0.4)'
              }}>
                Commission Signature
              </a>
            </div>

            {/* Card 3: Prestige */}
            <div data-id="pricing-card-3" style={{
              backgroundColor: '#111111',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '24px',
              padding: '40px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between'
            }}>
              <div>
                <span data-id="p3-title" style={{ fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.15em', color: '#a1a1aa', fontWeight: 600 }}>
                  Prestige
                </span>
                <div data-id="p3-pricing" style={{ marginTop: '20px', marginBottom: '16px' }}>
                  <span className="font-serif" style={{ fontSize: '48px', fontWeight: 600, color: '#ffffff' }}>$14,000+</span>
                </div>
                <p data-id="p3-desc" style={{ color: '#a1a1aa', fontSize: '14px', lineHeight: 1.6, marginBottom: '32px' }}>
                  Limitless creative direction, multi-locale deployment, custom WebGL physics, and ongoing retainer.
                </p>
                <div style={{ height: '1px', backgroundColor: 'rgba(255, 255, 255, 0.08)', marginBottom: '32px' }}></div>
                <ul data-id="p3-features" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <li style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '14px', color: '#e4e4e7' }}>
                    <span style={{ color: '#a1a1aa' }}>✓</span> Unlimited Multi-Page Architecture
                  </li>
                  <li style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '14px', color: '#e4e4e7' }}>
                    <span style={{ color: '#a1a1aa' }}>✓</span> Bespoke WebGL / 3D Canvas
                  </li>
                  <li style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '14px', color: '#e4e4e7' }}>
                    <span style={{ color: '#a1a1aa' }}>✓</span> Multi-Locale Localization
                  </li>
                </ul>
              </div>
              <a data-id="p3-button" href="#contact" style={{
                marginTop: '40px',
                display: 'block',
                textAlign: 'center',
                padding: '14px 24px',
                borderRadius: '9999px',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                color: '#ffffff',
                textDecoration: 'none',
                fontSize: '14px',
                fontWeight: 500,
                backgroundColor: 'rgba(255, 255, 255, 0.03)'
              }}>
                Inquire Enterprise
              </a>
            </div>

          </div>
        </div>
      </section>
  `;

  if (code.includes('data-id="pricing-section"')) {
    console.log('Pricing section already exists, replacing...');
    code = code.replace(/\{\/\* ─── PRICING SECTION[\s\S]*?<\/section>/, pricingSection.trim());
  } else {
    console.log('Injecting Pricing section before footer...');
    code = code.replace(/<footer data-id="footer"/, `${pricingSection.trim()}\n\n      <footer data-id="footer"`);
  }

  console.log('2. Submitting modified file via revyme_submit_files through MCP Bridge...');
  const submitRes = await callRpc('submitFiles', {
    files: [
      {
        path: ctx.result.activeFilePath,
        code: code,
        kind: ctx.result.kind || 'page',
      },
    ],
  });

  console.log('Submit Response from Oracle:', JSON.stringify(submitRes, null, 2));
}

run().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

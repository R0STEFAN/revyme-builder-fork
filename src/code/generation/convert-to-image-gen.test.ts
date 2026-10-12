import { describe, it, expect } from 'vitest';
import { convertDivToImageInCode } from './convert-to-image-gen';

describe('convertDivToImageInCode - replace mode', () => {
  it('converts plain div with backgroundImage into self-closing <img />', () => {
    const code = `
function Page() {
  return (
    <div
      data-id="hero"
      data-name="Hero"
      style={{
        width: '100%',
        height: '400px',
        backgroundImage: "url('https://example.com/banner.jpg')",
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }}
    >
      <span>Legacy child</span>
    </div>
  );
}`;
    const out = convertDivToImageInCode(code, 'hero', 'replace');
    expect(out).toContain('<img');
    expect(out).not.toContain('</img');
    expect(out).not.toContain('</div>');
    expect(out).not.toContain('Legacy child');
    expect(out).toContain('data-id="hero"');
    expect(out).toContain('data-name="Hero"');
    expect(out).toContain('src="https://example.com/banner.jpg"');
    expect(out).toContain('alt=""');
    expect(out).toContain('loading="lazy"');
    expect(out).toContain('decoding="async"');
    expect(out).toMatch(/objectFit:\s*['"]cover['"]/);
    expect(out).toMatch(/objectPosition:\s*['"]center['"]/);
    expect(out).toMatch(/display:\s*['"]block['"]/);
    expect(out).not.toContain('backgroundImage');
    expect(out).not.toContain('backgroundSize');
    expect(out).not.toContain('backgroundPosition');
    expect(out).not.toContain('backgroundRepeat');
  });

  it('converts self-closing div with backgroundImage', () => {
    const code = `
function Page() {
  return (
    <div
      data-id="card"
      style={{
        width: '300px',
        height: '200px',
        backgroundImage: 'url("https://example.com/card.png")',
      }}
    />
  );
}`;
    const out = convertDivToImageInCode(code, 'card');
    expect(out).toContain('<img');
    expect(out).toContain('src="https://example.com/card.png"');
    expect(out).toMatch(/width:\s*['"]300px['"]/);
    expect(out).toMatch(/height:\s*['"]200px['"]/);
    expect(out).toMatch(/display:\s*['"]block['"]/);
    expect(out).toMatch(/objectFit:\s*['"]cover['"]/);
    expect(out).toMatch(/objectPosition:\s*['"]center['"]/);
  });

  it('converts motion.div to motion.img', () => {
    const code = `
function Page() {
  return (
    <motion.div
      data-id="animated"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      style={{
        width: '200px',
        height: '200px',
        backgroundImage: "url('/assets/avatar.webp')",
      }}
    >
      <div data-id="nested">Inside</div>
    </motion.div>
  );
}`;
    const out = convertDivToImageInCode(code, 'animated', 'replace');
    expect(out).toContain('<motion.img');
    expect(out).not.toContain('</motion.img>');
    expect(out).not.toContain('</motion.div>');
    expect(out).not.toContain('Inside');
    expect(out).toContain('initial={{');
    expect(out).toContain('animate={{');
    expect(out).toContain('src="/assets/avatar.webp"');
    expect(out).toMatch(/objectFit:\s*['"]cover['"]/);
    expect(out).toMatch(/display:\s*['"]block['"]/);
  });

  it('handles CMS template literal backgroundImage: `url(${item.photo})`', () => {
    const code = `
function Item({ item }) {
  return (
    <div
      data-id="cms-pic"
      style={{
        width: '100%',
        height: '350px',
        backgroundImage: \`url(\${item.photo})\`,
        backgroundSize: 'cover',
      }}
    />
  );
}`;
    const out = convertDivToImageInCode(code, 'cms-pic', 'replace');
    expect(out).toContain('<img');
    expect(out).toContain('src={item.photo}');
    expect(out).not.toContain('srcSet');
    expect(out).not.toContain('sizes');
    expect(out).not.toContain('getUploadSrcSet');
    expect(out).not.toContain('url(');
    expect(out).not.toContain('backgroundImage');
    expect(out).toMatch(/objectFit:\s*['"]cover['"]/);
  });

  it('does not generate srcSet or sizes on canvas for static uploads', () => {
    const code = `
function Page() {
  return (
    <div
      data-id="upload-img"
      style={{
        width: '800px',
        height: '400px',
        backgroundImage: "url('/api/uploads/test-image.webp')",
      }}
    />
  );
}`;
    const out = convertDivToImageInCode(code, 'upload-img', 'replace');
    expect(out).toContain('<img');
    expect(out).toContain('src="/api/uploads/test-image.webp"');
    expect(out).not.toContain('srcSet');
    expect(out).not.toContain('sizes');
  });

  it('removes leftover srcSet and sizes if previously present', () => {
    const code = `
function Page() {
  return (
    <div
      data-id="thumb-img"
      srcSet="/api/uploads/thumb-320w.webp 320w"
      sizes="145px"
      style={{
        width: '145px',
        height: '121px',
        backgroundImage: "url('/api/uploads/thumb.webp')",
      }}
    />
  );
}`;
    const out = convertDivToImageInCode(code, 'thumb-img', 'replace');
    expect(out).toContain('src="/api/uploads/thumb.webp"');
    expect(out).not.toContain('srcSet');
    expect(out).not.toContain('sizes');
  });

  it('translates custom backgroundSize and backgroundPosition to objectFit and objectPosition', () => {
    const code = `
function Page() {
  return (
    <div
      data-id="fitted"
      style={{
        width: '500px',
        height: '300px',
        backgroundImage: "url('https://example.com/logo.svg')",
        backgroundSize: 'contain',
        backgroundPosition: 'top left',
      }}
    />
  );
}`;
    const out = convertDivToImageInCode(code, 'fitted', 'replace');
    expect(out).toMatch(/objectFit:\s*['"]contain['"]/);
    expect(out).toMatch(/objectPosition:\s*['"]top left['"]/);
    expect(out).not.toContain('backgroundSize');
    expect(out).not.toContain('backgroundPosition');
  });

  it('preserves other styles such as width, height, borderRadius, margin, etc.', () => {
    const code = `
function Page() {
  return (
    <div
      data-id="styled"
      style={{
        width: '400px',
        height: '250px',
        borderRadius: '16px',
        margin: '20px auto',
        boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
        opacity: 0.95,
        backgroundImage: "url('https://example.com/image.jpg')",
        backgroundSize: 'cover',
      }}
    />
  );
}`;
    const out = convertDivToImageInCode(code, 'styled', 'replace');
    expect(out).toMatch(/width:\s*['"]400px['"]/);
    expect(out).toMatch(/height:\s*['"]250px['"]/);
    expect(out).toMatch(/borderRadius:\s*['"]16px['"]/);
    expect(out).toMatch(/margin:\s*['"]20px auto['"]/);
    expect(out).toMatch(/boxShadow:\s*['"]0 4px 12px rgba\(0,0,0,0.1\)['"]/);
    expect(out).toContain('opacity: 0.95');
    expect(out).toMatch(/objectFit:\s*['"]cover['"]/);
    expect(out).toMatch(/display:\s*['"]block['"]/);
  });

  it('preserves existing alt attribute if already present', () => {
    const code = `
function Page() {
  return (
    <div
      data-id="with-alt"
      alt="User Profile"
      style={{
        width: '100px',
        height: '100px',
        backgroundImage: "url('https://example.com/user.jpg')",
      }}
    />
  );
}`;
    const out = convertDivToImageInCode(code, 'with-alt', 'replace');
    expect(out).toContain('alt="User Profile"');
    expect((out.match(/alt=/g) ?? []).length).toBe(1);
  });

  it('returns code unchanged if nodeId is not found', () => {
    const code = `<div data-id="other" />`;
    expect(convertDivToImageInCode(code, 'not-found', 'replace')).toBe(code);
  });
});

describe('convertDivToImageInCode - nested-background mode', () => {
  it('inserts first child img and keeps existing children', () => {
    const code = `
function Page() {
  return (
    <div
      data-id="container"
      data-name="Hero Section"
      style={{
        width: '100%',
        height: '600px',
        backgroundImage: "url('https://example.com/hero-bg.jpg')",
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }}
    >
      <h1 data-id="headline">Welcome</h1>
      <p data-id="subtext">Subtitle</p>
    </div>
  );
}`;
    const out = convertDivToImageInCode(code, 'container', 'nested-background');
    // Container remains a div
    expect(out).toContain('<div');
    expect(out).toContain('data-id="container"');
    expect(out).toContain('</div>');

    // Container gets position: relative and overflow: hidden
    expect(out).toMatch(/position:\s*['"]relative['"]/);
    expect(out).toMatch(/overflow:\s*['"]hidden['"]/);

    // Background image removed from container
    expect(out).not.toContain("backgroundImage: 'url");

    // Child image is generated as first child
    expect(out).toContain('data-id="container-img"');
    expect(out).toContain('data-name="Background Image"');
    expect(out).toContain('src="https://example.com/hero-bg.jpg"');
    expect(out).toContain('alt=""');
    expect(out).toContain('loading="lazy"');
    expect(out).toContain('decoding="async"');
    expect(out).toMatch(/position:\s*['"]absolute['"]/);
    expect(out).toContain('inset: 0');
    expect(out).toMatch(/width:\s*['"]100%['"]/);
    expect(out).toMatch(/height:\s*['"]100%['"]/);
    expect(out).toMatch(/objectFit:\s*['"]cover['"]/);
    expect(out).toMatch(/objectPosition:\s*['"]center['"]/);
    expect(out).toMatch(/pointerEvents:\s*['"]none['"]/);
    expect(out).toContain('zIndex: 0');

    // Child image comes before h1 and p
    const imgIdx = out.indexOf('data-id="container-img"');
    const h1Idx = out.indexOf('data-id="headline"');
    const pIdx = out.indexOf('data-id="subtext"');
    expect(imgIdx).toBeGreaterThan(-1);
    expect(imgIdx).toBeLessThan(h1Idx);
    expect(h1Idx).toBeLessThan(pIdx);
  });

  it('converts self-closing container to open/close tag containing child img', () => {
    const code = `
function Page() {
  return (
    <div
      data-id="empty-box"
      style={{
        width: '300px',
        height: '200px',
        backgroundImage: "url('https://example.com/bg.png')",
      }}
    />
  );
}`;
    const out = convertDivToImageInCode(code, 'empty-box', 'nested-background');
    expect(out).toContain('<div');
    expect(out).toContain('</div>');
    expect(out).toContain('data-id="empty-box-img"');
    expect(out).toContain('src="https://example.com/bg.png"');
    expect(out).toMatch(/position:\s*['"]relative['"]/);
    expect(out).toMatch(/overflow:\s*['"]hidden['"]/);
  });

  it('keeps gradient on container when multi-layer background is used', () => {
    const code = `
function Page() {
  return (
    <div
      data-id="layered"
      style={{
        width: '100%',
        height: '400px',
        backgroundImage: "linear-gradient(rgba(0, 0, 0, 0.5), rgba(0, 0, 0, 0.8)), url('https://example.com/photo.jpg')",
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      <span data-id="txt">Content</span>
    </div>
  );
}`;
    const out = convertDivToImageInCode(code, 'layered', 'nested-background');
    // Container still has the gradient
    expect(out).toContain("linear-gradient(rgba(0, 0, 0, 0.5), rgba(0, 0, 0, 0.8))");
    // But url() is removed from container's backgroundImage
    expect(out).not.toMatch(/backgroundImage:\s*['"][^'"]*url\(/);

    // Child img has the extracted url
    expect(out).toContain('data-id="layered-img"');
    expect(out).toContain('src="https://example.com/photo.jpg"');
    expect(out).toContain('data-id="txt"');
  });

  it('handles CMS template literal in nested-background mode', () => {
    const code = `
function Card({ item }) {
  return (
    <div
      data-id="cms-card"
      style={{
        width: '280px',
        height: '180px',
        backgroundImage: \`url(\${item.photo})\`,
        backgroundSize: 'cover',
      }}
    >
      <h3 data-id="h3">{item.title}</h3>
    </div>
  );
}`;
    const out = convertDivToImageInCode(code, 'cms-card', 'nested-background');
    expect(out).toContain('data-id="cms-card-img"');
    expect(out).toContain('src={item.photo}');
    expect(out).toContain('data-id="h3"');
    expect(out).toMatch(/overflow:\s*['"]hidden['"]/);
  });

  it('preserves existing absolute/fixed/relative position on container', () => {
    const code = `
function Page() {
  return (
    <div
      data-id="abs-box"
      style={{
        position: 'absolute',
        top: '10px',
        left: '20px',
        width: '200px',
        height: '200px',
        backgroundImage: "url('/test.jpg')",
      }}
    />
  );
}`;
    const out = convertDivToImageInCode(code, 'abs-box', 'nested-background');
    expect(out).toMatch(/position:\s*['"]absolute['"]/);
    expect(out).toMatch(/overflow:\s*['"]hidden['"]/);
    expect(out).toContain('data-id="abs-box-img"');
  });

  it('is idempotent when run multiple times in nested-background mode', () => {
    const code = `
function Page() {
  return (
    <div
      data-id="multi"
      style={{
        width: '100px',
        height: '100px',
        backgroundImage: "url('https://example.com/v1.jpg')",
      }}
    />
  );
}`;
    const once = convertDivToImageInCode(code, 'multi', 'nested-background');
    const twice = convertDivToImageInCode(once, 'multi', 'nested-background');
    expect((twice.match(/data-id="multi-img"/g) ?? []).length).toBe(1);
  });
});

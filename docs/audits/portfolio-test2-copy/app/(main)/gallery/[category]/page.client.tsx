'use client';

/** @canvas {
  "viewports": [
    {
      "id": "desktop",
      "label": "Desktop",
      "width": 1200,
      "isPrimary": true,
      "order": 0,
      "height": "auto"
    }
  ],
  "positions": {
    "desktop": {
      "x": -16,
      "y": -111
    }
  }
} */
import React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import tattoos from '@/cms/tattoos.json';

export default function Page() {
  const params = useParams();
  return <div data-id="root" data-name="/gallery/[category]" style={{
    position: 'relative',
    width: '100%',
    height: 'auto',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center'
  }}>

    <div data-id="frame-muye62j1-1" data-name="Frame" style={{
      width: 'auto',
      height: 'min-content',
      backgroundColor: '#ffffff',
      flex: '0 0 auto',
      position: 'relative', order: '0', alignSelf: 'stretch', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', display: 'flex', zIndex: '1', paddingTop: '100px'
    }}>
      <div data-id="frame-muye62j1-2" data-name="Tattoos" style={{
        display: "grid",
        gap: '12px',
        width: 'auto',
        padding: '12px',
        backgroundColor: '#ffffff',
        borderRadius: '8px',
        flex: '0 0 auto',
        position: 'relative',
        order: '0',
        alignSelf: 'stretch',
        gridTemplateColumns: "repeat(2, minmax(0, 1fr))"
      }} data-query-config={JSON.stringify({"isApiMode":true,"params":[{"key":"filter[categories_m2m][categories_id][slug][_eq]","value":"params.category","isExpression":true}]})}>
        {tattoos.map((item, idx) => <Link data-cms-nav="row" data-id="item-muye62j1-3" key={idx} data-name="Tattoo" style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: '12px',
          padding: '8px',
          width: '100%',
          position: 'relative',
          textDecoration: 'none',
          color: 'inherit'
        }} href={"/tattoos/" + item.slug}>
          <img data-id="image-muye62j1-4" alt={item.alt_text} loading="lazy" decoding="async" style={{
            width: '210px',
            height: '134px',
            borderRadius: '8px',
            flexShrink: '0',
            order: '0',
            position: 'relative',
            objectFit: 'cover',
            objectPosition: 'center',
            display: "block"
          }} src={"https://api.tattoozp.com/assets/" + item.img_file.id + "?width=500&quality=80"} />
          <h3 data-id="heading-muye62j1-5" style={{
            fontSize: '18px',
            fontWeight: '700',
            color: '#111',
            order: '1',
            flex: '1 0 0px',
            position: 'relative'
          }}>{item.title}</h3>
        </Link>)}
      </div>
    </div>
  </div>;
}
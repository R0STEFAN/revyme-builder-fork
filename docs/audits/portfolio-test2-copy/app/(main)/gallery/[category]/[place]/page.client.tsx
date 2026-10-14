'use client';

/** @propMeta {"hide":{"label":"Hide"}} */
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
      "x": 0,
      "y": 0
    }
  }
} */
/** @pageVariables {
  "variables": [
    {
      "name": "hide",
      "type": "boolean",
      "default": "false"
    }
  ]
} */

import React from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import tattoos from '@/cms/tattoos.json';

const MotionLink = motion.create(React.forwardRef(function MotionLinkBase({
  href,
  ...props
}: any, ref: any) {
  return href ? <Link data-id="Link-mv7rmdlc-1" ref={ref} href={href} {...props} /> : <div ref={ref} {...props} />;
}));
export default function Page() {
  const params = useParams();
  return <div data-id="root" data-name="/gallery/[category]/[place]" style={{
    position: 'relative',
    width: '100%',
    flexDirection: 'column',
    alignItems: 'center',
    display: 'flex',
    height: 'auto'
  }}>

    
      
    <div data-id="frame-muzrh7gx-1" data-name="Frame" style={{
      width: '100%',
      backgroundColor: '#ffffff',
      flex: '0 0 auto',
      position: 'relative',
      order: '0',
      paddingTop: '100px',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      display: 'flex',
      flexWrap: 'nowrap',
      height: 'min-content'
    }}>
  
    <div data-id="frame-mv7ra9vc-5" data-name="Tattoos" style={{
        display: "grid",

        gap: '12px',
        width: 'auto',
        padding: '12px',
        backgroundColor: '#ffffff',
        borderRadius: '8px',
        flex: '0 0 auto',
        position: 'relative',
        order: '0',
        alignSelf: 'stretch', gridTemplateColumns: "repeat(2, minmax(0, 1fr))"
      }} data-query-config={JSON.stringify({"isApiMode":true,"params":[{"key":"filter[categories_m2m][categories_id][slug][_eq]","value":"params.category","isExpression":true},{"key":"filter[placements_m2m][placements_id][slug][_eq]","value":"params.place","isExpression":true}]})}>
        {tattoos.map((item, idx) => <Link data-cms-nav="row" data-id="item-mv7ra9vd-6" key={idx} data-name="Tattoo" style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: '12px',
          padding: '8px',
          width: '100%', position: 'relative',
          textDecoration: 'none',
          color: 'inherit'
        }} href={"/tattoos/" + item.slug}>
          <img data-id="image-mv7ra9vd-7" alt={item.alt_text} loading="lazy" decoding="async" style={{
            width: '210px',
            height: '134px',
            borderRadius: '8px',
            flexShrink: '0',
            order: '0',
            position: 'relative',
            objectFit: 'cover',
            objectPosition: 'center',
            display: "block"
          }}  src={"https://api.tattoozp.com/assets/" + item.img_file.id + "?width=500&quality=80"} />
          <h3 data-id="heading-mv7ra9vd-8" style={{
            fontSize: '18px',
            fontWeight: '700',
            color: '#111',
            order: '1',
            flex: '1 0 0px',
            position: 'relative'
          }}>{item.title}</h3>
        </Link>)}
      </div>
  </div></div>;
}
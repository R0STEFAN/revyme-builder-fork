// ModelViewer — Code component template (Three.js .glb model viewer with orbit camera).

export const MODEL_VIEWER_COMPONENT = `'use client';

/** @label "3D Model Viewer" */
/** @comment "Interactive Three.js 3D model viewer for .glb files" */
/** @defaultWidth 600 */
/** @defaultHeight 400 */
/** @controls {
  "modelPath": { "type": "text", "label": "Model (.glb)", "default": "" },
  "cameraX": { "type": "number", "label": "Camera Orbit X", "min": -180, "max": 180, "default": 0, "step": 1 },
  "cameraY": { "type": "number", "label": "Camera Orbit Y", "min": -90, "max": 90, "default": 20, "step": 1 },
  "cameraDistance": { "type": "number", "label": "Camera Distance", "min": 1, "max": 20, "default": 5, "step": 0.1 },
  "rotateY": { "type": "number", "label": "Model Rotation", "min": -180, "max": 180, "default": 0, "step": 1 },
  "envIntensity": { "type": "number", "label": "Lighting", "min": 0, "max": 3, "default": 1, "step": 0.1 },
  "bgColor": { "type": "color", "label": "Background", "default": "transparent" },
  "autoRotate": { "type": "toggle", "label": "Auto Rotate", "default": false }
} */

import { useState, useEffect, useRef } from 'react';
import { withResponsiveProps, useStaticCanvas } from '@revyme/runtime';

function ModelViewer({
  modelPath = '', cameraX = 0, cameraY = 20, cameraDistance = 5,
  rotateY = 0, envIntensity = 1, bgColor = 'transparent', autoRotate = false,
  ...props
}) {
  const containerRef = useRef(null);
  const controllerRef = useRef(null);
  const latestRef = useRef(null);
  const applyRef = useRef(null);
  const isStatic = useStaticCanvas();
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(Boolean(modelPath));

  latestRef.current = { cameraX, cameraY, cameraDistance, rotateY, envIntensity, bgColor, autoRotate };
  applyRef.current = () => {
    const controller = controllerRef.current;
    if (!controller) return;
    const values = latestRef.current;
    const phi = (90 - values.cameraY) * Math.PI / 180;
    const theta = values.cameraX * Math.PI / 180;
    const camera = controller.camera;
    camera.position.x = values.cameraDistance * Math.sin(phi) * Math.sin(theta);
    camera.position.y = values.cameraDistance * Math.cos(phi);
    camera.position.z = values.cameraDistance * Math.sin(phi) * Math.cos(theta);
    camera.lookAt(0, 0, 0);
    if (controller.model) controller.model.rotation.y = values.rotateY * Math.PI / 180;
    controller.lights[0].intensity = 0.4 * values.envIntensity;
    controller.lights[1].intensity = 0.8 * values.envIntensity;
    controller.lights[2].intensity = 0.3 * values.envIntensity;
    controller.renderer.setClearColor(new controller.THREE.Color(values.bgColor === 'transparent' ? '#000000' : values.bgColor), values.bgColor === 'transparent' ? 0 : 1);
    if (isStatic && controller.ready) controller.renderer.render(controller.scene, camera);
  };

  useEffect(() => { applyRef.current?.(); }, [cameraX, cameraY, cameraDistance, rotateY, envIntensity, bgColor, isStatic]);

  function disposeModel(model) {
    if (!model) return;
    const disposed = new Set();
    const dispose = (resource) => {
      if (resource && typeof resource.dispose === 'function' && !disposed.has(resource)) {
        disposed.add(resource);
        resource.dispose();
      }
    };
    const disposeMaterial = (material) => {
      if (!material) return;
      for (const value of Object.values(material)) {
        if (value?.isTexture) dispose(value);
      }
      dispose(material);
    };
    model.traverse((object) => {
      dispose(object.geometry);
      if (Array.isArray(object.material)) object.material.forEach(disposeMaterial);
      else disposeMaterial(object.material);
    });
  }

  useEffect(() => {
    let cancelled = false;
    let controller = null;
    const container = containerRef.current;
    if (!container) return;
    setError(null);
    setLoading(Boolean(modelPath));

    async function init() {
      try {
        const THREE = await import('three');
        const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');

        if (cancelled) return;

        const scene = new THREE.Scene();
        const width = Math.max(1, container.offsetWidth);
        const height = Math.max(1, container.offsetHeight);
        const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setSize(width, height);
        renderer.setPixelRatio(window.devicePixelRatio || 1);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1;
        container.appendChild(renderer.domElement);

        const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
        scene.add(ambientLight);
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
        dirLight.position.set(5, 10, 7);
        scene.add(dirLight);
        const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
        fillLight.position.set(-5, 3, -5);
        scene.add(fillLight);

        controller = { THREE, scene, camera, renderer, lights: [ambientLight, dirLight, fillLight], model: null, ready: false, raf: 0, observer: null };
        controllerRef.current = controller;
        applyRef.current?.();

        const resize = () => {
          if (cancelled) return;
          const nextWidth = Math.max(1, container.offsetWidth);
          const nextHeight = Math.max(1, container.offsetHeight);
          camera.aspect = nextWidth / nextHeight;
          camera.updateProjectionMatrix();
          renderer.setSize(nextWidth, nextHeight);
          if (isStatic && controller.ready) renderer.render(scene, camera);
        };
        if (typeof ResizeObserver !== 'undefined') {
          controller.observer = new ResizeObserver(resize);
          controller.observer.observe(container);
        }

        if (modelPath) {
          const loader = new GLTFLoader();
          loader.load(
            modelPath,
            (gltf) => {
              if (cancelled) { disposeModel(gltf.scene); return; }
              const model = gltf.scene;
              const box = new THREE.Box3().setFromObject(model);
              const center = box.getCenter(new THREE.Vector3());
              model.position.sub(center);
              const size = box.getSize(new THREE.Vector3()).length();
              const scale = size > 0 ? 2 / size : 1;
              model.scale.setScalar(scale);
              scene.add(model);
              controller.model = model;
              controller.ready = true;
              applyRef.current?.();
              setLoading(false);
            },
            undefined,
            (err) => { if (!cancelled) { setError('Failed to load model'); setLoading(false); } }
          );
        } else {
          controller.ready = true;
          if (isStatic) renderer.render(scene, camera);
        }

        function animate() {
          if (cancelled) return;
          if (controller.model && latestRef.current.autoRotate) controller.model.rotation.y += 0.005;
          renderer.render(scene, camera);
          if (!isStatic) controller.raf = requestAnimationFrame(animate);
        }
        if (!isStatic) animate();
      } catch (err) {
        if (!cancelled) { setError('Three.js not available'); setLoading(false); }
      }
    }

    init();

    return () => {
      cancelled = true;
      if (controller) {
        if (controller.raf) cancelAnimationFrame(controller.raf);
        controller.observer?.disconnect();
        disposeModel(controller.model);
        controller.renderer.dispose();
        controller.renderer.domElement.remove();
        if (controllerRef.current === controller) controllerRef.current = null;
      }
    };
  }, [modelPath, isStatic]);

  return (
    <div ref={containerRef} data-id={props['data-id']} data-name={props['data-name']}
         style={{ position: 'relative', overflow: 'hidden', ...props.style }}>
      {loading && (
        <div style={{position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666', fontSize: 12}}>
          Loading model...
        </div>
      )}
      {error && (
        <div style={{position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f87171', fontSize: 12}}>
          {error}
        </div>
      )}
    </div>
  );
}

export default withResponsiveProps(ModelViewer);
`;

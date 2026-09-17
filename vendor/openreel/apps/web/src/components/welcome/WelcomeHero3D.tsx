import React, { useRef, useEffect, useMemo } from "react";
import * as THREE from "three";

interface WelcomeHero3DProps {
  className?: string;
}

export const WelcomeHero3D: React.FC<WelcomeHero3DProps> = ({
  className = "",
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const frameIdRef = useRef<number>(0);
  const mouseRef = useRef({ x: 0, y: 0 });
  const videoFramesRef = useRef<THREE.Group | null>(null);
  const particlesRef = useRef<THREE.Points | null>(null);

  const primaryColor = useMemo(() => new THREE.Color(0x22c55e), []);
  const secondaryColor = useMemo(() => new THREE.Color(0x16a34a), []);

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
    camera.position.z = 8;
    camera.position.y = 0.5;
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const videoFrames = new THREE.Group();
    videoFramesRef.current = videoFrames;
    scene.add(videoFrames);

    const frameConfigs = [
      {
        aspect: 9 / 16,
        scale: 1.2,
        position: new THREE.Vector3(-2.5, 0.3, 0),
        rotation: -0.15,
      },
      {
        aspect: 16 / 9,
        scale: 1.4,
        position: new THREE.Vector3(0, -0.2, 1),
        rotation: 0,
      },
      {
        aspect: 1,
        scale: 0.9,
        position: new THREE.Vector3(2.3, 0.5, -0.5),
        rotation: 0.12,
      },
      {
        aspect: 9 / 16,
        scale: 0.8,
        position: new THREE.Vector3(3.5, -0.8, -1),
        rotation: 0.2,
      },
      {
        aspect: 16 / 9,
        scale: 0.7,
        position: new THREE.Vector3(-3.2, -0.6, -1.5),
        rotation: -0.1,
      },
    ];

    frameConfigs.forEach((config, index) => {
      const frameGroup = new THREE.Group();

      const frameWidth =
        config.aspect > 1 ? 1.6 * config.scale : 0.9 * config.scale;
      const frameHeight =
        config.aspect > 1 ? 0.9 * config.scale : 1.6 * config.scale;

      const borderGeometry = new THREE.PlaneGeometry(
        frameWidth + 0.06,
        frameHeight + 0.06,
      );
      const borderMaterial = new THREE.MeshBasicMaterial({
        color: primaryColor,
        transparent: true,
        opacity: 0.6 + index * 0.08,
        side: THREE.DoubleSide,
      });
      const border = new THREE.Mesh(borderGeometry, borderMaterial);
      border.position.z = -0.01;
      frameGroup.add(border);

      const innerGeometry = new THREE.PlaneGeometry(frameWidth, frameHeight);
      const innerMaterial = new THREE.MeshBasicMaterial({
        color: 0x18181b,
        transparent: true,
        opacity: 0.95,
        side: THREE.DoubleSide,
      });
      const inner = new THREE.Mesh(innerGeometry, innerMaterial);
      frameGroup.add(inner);

      const lineCount = config.aspect > 1 ? 4 : 6;
      for (let i = 0; i < lineCount; i++) {
        const lineGeometry = new THREE.PlaneGeometry(
          frameWidth * (0.3 + Math.random() * 0.5),
          0.02,
        );
        const lineMaterial = new THREE.MeshBasicMaterial({
          color: i === 0 ? primaryColor : 0x3f3f46,
          transparent: true,
          opacity: i === 0 ? 0.8 : 0.4,
        });
        const line = new THREE.Mesh(lineGeometry, lineMaterial);
        line.position.x = (Math.random() - 0.5) * frameWidth * 0.4;
        line.position.y =
          frameHeight * 0.3 - i * (frameHeight / (lineCount + 1));
        line.position.z = 0.01;
        frameGroup.add(line);
      }

      if (index === 1) {
        const playSize = 0.25;
        const playShape = new THREE.Shape();
        playShape.moveTo(0, playSize * 0.5);
        playShape.lineTo(playSize * 0.866, 0);
        playShape.lineTo(0, -playSize * 0.5);
        playShape.lineTo(0, playSize * 0.5);

        const playGeometry = new THREE.ShapeGeometry(playShape);
        const playMaterial = new THREE.MeshBasicMaterial({
          color: primaryColor,
          transparent: true,
          opacity: 0.9,
        });
        const playButton = new THREE.Mesh(playGeometry, playMaterial);
        playButton.position.set(0.05, 0, 0.02);
        frameGroup.add(playButton);
      }

      frameGroup.position.copy(config.position);
      frameGroup.rotation.y = config.rotation;
      frameGroup.userData = {
        originalPosition: config.position.clone(),
        phase: index * 0.8,
        floatSpeed: 0.3 + index * 0.1,
        floatAmount: 0.08 + index * 0.02,
      };

      videoFrames.add(frameGroup);
    });

    const particleCount = 80;
    const particleGeometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const sizes = new Float32Array(particleCount);
    const opacities = new Float32Array(particleCount);

    for (let i = 0; i < particleCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 12;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 8;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 6 - 2;
      sizes[i] = Math.random() * 0.03 + 0.01;
      opacities[i] = Math.random() * 0.5 + 0.2;
    }

    particleGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(positions, 3),
    );
    particleGeometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));

    const particleMaterial = new THREE.PointsMaterial({
      color: primaryColor,
      size: 0.05,
      transparent: true,
      opacity: 0.4,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
    });

    const particles = new THREE.Points(particleGeometry, particleMaterial);
    particlesRef.current = particles;
    scene.add(particles);

    const ringGeometry = new THREE.RingGeometry(3.5, 3.55, 64);
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: primaryColor,
      transparent: true,
      opacity: 0.08,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.position.z = -3;
    ring.rotation.x = 0.3;
    scene.add(ring);

    const ring2 = ring.clone();
    ring2.scale.set(0.7, 0.7, 1);
    ring2.material = ringMaterial.clone();
    (ring2.material as THREE.MeshBasicMaterial).opacity = 0.05;
    scene.add(ring2);

    const handleMouseMove = (event: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      mouseRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouseRef.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    };

    const handleResize = () => {
      if (!containerRef.current || !cameraRef.current || !rendererRef.current)
        return;
      const newWidth = containerRef.current.clientWidth;
      const newHeight = containerRef.current.clientHeight;
      cameraRef.current.aspect = newWidth / newHeight;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(newWidth, newHeight);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("resize", handleResize);

    let time = 0;
    const animate = () => {
      time += 0.016;

      if (videoFramesRef.current) {
        videoFramesRef.current.children.forEach((frame) => {
          const userData = frame.userData;
          const floatY =
            Math.sin(time * userData.floatSpeed + userData.phase) *
            userData.floatAmount;
          const floatX =
            Math.cos(time * userData.floatSpeed * 0.7 + userData.phase) *
            userData.floatAmount *
            0.5;
          frame.position.y = userData.originalPosition.y + floatY;
          frame.position.x = userData.originalPosition.x + floatX;
        });

        videoFramesRef.current.rotation.y = mouseRef.current.x * 0.05;
        videoFramesRef.current.rotation.x = mouseRef.current.y * 0.03;
      }

      if (particlesRef.current) {
        const positions = particlesRef.current.geometry.attributes.position
          .array as Float32Array;
        for (let i = 0; i < positions.length; i += 3) {
          positions[i + 1] += 0.002;
          if (positions[i + 1] > 4) {
            positions[i + 1] = -4;
          }
        }
        particlesRef.current.geometry.attributes.position.needsUpdate = true;
        particlesRef.current.rotation.y = time * 0.02;
      }

      if (cameraRef.current) {
        cameraRef.current.position.x +=
          (mouseRef.current.x * 0.3 - cameraRef.current.position.x) * 0.02;
        cameraRef.current.position.y +=
          (mouseRef.current.y * 0.2 + 0.5 - cameraRef.current.position.y) *
          0.02;
        cameraRef.current.lookAt(0, 0, 0);
      }

      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }

      frameIdRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("resize", handleResize);
      cancelAnimationFrame(frameIdRef.current);

      if (rendererRef.current) {
        rendererRef.current.dispose();
        container.removeChild(rendererRef.current.domElement);
      }

      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          if (Array.isArray(object.material)) {
            object.material.forEach((m) => m.dispose());
          } else {
            object.material.dispose();
          }
        }
      });
    };
  }, [primaryColor, secondaryColor]);

  return (
    <div
      ref={containerRef}
      className={`absolute inset-0 ${className}`}
      style={{ pointerEvents: "none" }}
    />
  );
};

export default WelcomeHero3D;

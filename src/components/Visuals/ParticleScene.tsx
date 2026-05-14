import React, { useRef, useMemo, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

interface ParticleSceneProps {
  audioData: Float32Array;
  interactionPoint: THREE.Vector3 | null;
  mode: 'idle' | 'interaction' | 'flow' | 'climax';
  intensity: number;
  isStarted?: boolean;
}

export const ParticleScene: React.FC<ParticleSceneProps> = ({ audioData, interactionPoint, mode, intensity, isStarted }) => {
  const pointsRef = useRef<THREE.Points>(null);
  const meshRef = useRef<THREE.Group>(null);
  const count = 50000;
  const shardCount = 200;
  const { size } = useThree();
  const opacityRef = useRef(0);
  const colorRef = useRef(new THREE.Color("#22d3ee"));

  const [positions, initialPositions] = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const init = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // Distribution: Mixture of global shell and dense core
      const type = Math.random();
      let r, theta, phi;

      if (type > 0.6) {
        // Enclosing Shell (Irregular)
        r = 10 + Math.random() * 5;
        theta = Math.random() * Math.PI * 2;
        phi = Math.acos(2 * Math.random() - 1);
      } else if (type > 0.2) {
        // Wide Field
        r = Math.random() * 20;
        theta = Math.random() * Math.PI * 2;
        phi = Math.acos(2 * Math.random() - 1);
      } else {
        // Dense Core
        r = Math.random() * 3;
        theta = Math.random() * Math.PI * 2;
        phi = Math.acos(2 * Math.random() - 1);
      }
      
      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = r * Math.sin(phi) * Math.sin(theta);
      const z = r * Math.cos(phi);
      
      pos[i * 3] = init[i * 3] = x;
      pos[i * 3 + 1] = init[i * 3 + 1] = y;
      pos[i * 3 + 2] = init[i * 3 + 2] = z;
    }
    return [pos, init];
  }, [count]);

  const shardData = useMemo(() => {
    return Array.from({ length: shardCount }).map(() => ({
      position: new THREE.Vector3(
        (Math.random() - 0.5) * 30,
        (Math.random() - 0.5) * 20,
        (Math.random() - 0.5) * 10
      ),
      rotation: new THREE.Euler(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI),
      scale: 0.05 + Math.random() * 0.1,
      speed: 0.1 + Math.random() * 0.5
    }));
  }, [shardCount]);

  useFrame((state) => {
    const time = state.clock.getElapsedTime();
    
    if (pointsRef.current) {
      const posAttr = pointsRef.current.geometry.attributes.position;
      const mat = pointsRef.current.material as THREE.PointsMaterial;

      // Opacity logic: home screen is dark unless interaction
      if (mode === 'interaction') {
        opacityRef.current = 0.8 + (intensity * 0.2);
      } else if (mode === 'climax') {
        opacityRef.current = THREE.MathUtils.lerp(opacityRef.current, 0.6 + (intensity * 0.4), 0.05);
      } else if (mode === 'flow') {
        opacityRef.current = THREE.MathUtils.lerp(opacityRef.current, 0.4 + (intensity * 0.3), 0.05);
      } else {
        // Very low base opacity on homepage, boosted by frequency intensity
        const baseIdle = mode === 'idle' && !isStarted ? 0.005 : 0.05;
        opacityRef.current = THREE.MathUtils.lerp(opacityRef.current, baseIdle + (intensity * 0.4), 0.02);
      }
      mat.opacity = opacityRef.current;

      // Color Spectrum Shift based on intensity
      const c1 = new THREE.Color("#22d3ee"); // Base Cyan
      const c2 = new THREE.Color("#8b5cf6"); // Vibrant Purple
      const c3 = new THREE.Color("#ec4899"); // Hot Pink
      const c4 = new THREE.Color("#ffffff"); // Pure Light
      
      if (intensity < 0.4) {
        colorRef.current.copy(c1).lerp(c2, intensity / 0.4);
      } else if (intensity < 0.8) {
        colorRef.current.copy(c2).lerp(c3, (intensity - 0.4) / 0.4);
      } else {
        colorRef.current.copy(c3).lerp(c4, (intensity - 0.8) / 0.2);
      }
      mat.color.copy(colorRef.current);

      // Particle quantity responds directly to intensity and mode
      const baseVisible = (mode === 'idle' && !isStarted) ? 8000 : 25000;
      const activeCount = Math.floor(baseVisible + (count - baseVisible) * intensity);
      pointsRef.current.geometry.setDrawRange(0, activeCount);

      // Dynamic size and glow
      mat.size = 0.03 + (intensity * 0.08);

      for (let i = 0; i < count; i++) {
        const ix = i * 3;
        const iy = i * 3 + 1;
        const iz = i * 3 + 2;

        const audioIdx = i % audioData.length;
        const audioValue = Math.abs(audioData[audioIdx]) * 3.0;
        
        // Repulsion/Ripple towards Interaction
        if (interactionPoint && (mode === 'interaction' || mode === 'climax')) {
          const dx = posAttr.array[ix] - interactionPoint.x;
          const dy = posAttr.array[iy] - interactionPoint.y;
          const dz = posAttr.array[iz] - (interactionPoint.z || 0);
          const distSq = dx * dx + dy * dy + dz * dz;
          const dist = Math.sqrt(distSq);
          
          if (dist < 12) {
            // Highly aggressive repulsion for "scatter" effect, amplified by intensity
            const force = (12 - dist) * (0.8 + intensity * 1.5);
            posAttr.array[ix] += (dx / dist) * force;
            posAttr.array[iy] += (dy / dist) * force;
            posAttr.array[iz] += (dz / dist) * force;
          }
        }

        // Return to initial positions slowly to avoid drifting away
        const lerpFactor = mode === 'interaction' ? (0.005 / (1 + intensity)) : 0.012;
        posAttr.array[ix] += (initialPositions[ix] - posAttr.array[ix]) * lerpFactor;
        posAttr.array[iy] += (initialPositions[iy] - posAttr.array[iy]) * lerpFactor;
        posAttr.array[iz] += (initialPositions[iz] - posAttr.array[iz]) * lerpFactor;

        // Subtle noise
        posAttr.array[ix] += Math.sin(time * 0.2 + initialPositions[iz]) * 0.001;
        posAttr.array[iy] += Math.cos(time * 0.2 + initialPositions[ix]) * 0.001;
      }
      posAttr.needsUpdate = true;
      pointsRef.current.rotation.y += 0.0005;
    }

    if (meshRef.current) {
      meshRef.current.rotation.y = time * 0.05;
      meshRef.current.visible = mode !== 'idle';
      meshRef.current.children.forEach((child, i) => {
        child.rotation.x += 0.01;
        child.rotation.z += 0.005;
        child.position.y += Math.sin(time + i) * 0.002;
      });
    }
  });

  return (
    <group>
      <points ref={pointsRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={count}
            array={positions}
            itemSize={3}
          />
        </bufferGeometry>
        <pointsMaterial
          size={0.03}
          color="#22d3ee"
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          sizeAttenuation={true}
        />
      </points>

      <group ref={meshRef}>
        {shardData.map((data, i) => (
          <mesh key={i} position={data.position} rotation={data.rotation} scale={data.scale}>
            <boxGeometry args={[1, 1, 1]} />
            <meshStandardMaterial 
              color="#4f46e5" 
              emissive="#22d3ee" 
              emissiveIntensity={2} 
              transparent 
              opacity={0.1} 
            />
          </mesh>
        ))}
      </group>
    </group>
  );
};

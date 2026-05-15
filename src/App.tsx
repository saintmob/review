import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAudio } from './hooks/useAudio';
import { useHandTracking } from './hooks/useHandTracking';
import { motion, AnimatePresence } from 'motion/react';
import { Canvas } from '@react-three/fiber';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { ParticleScene } from './components/Visuals/ParticleScene';
import * as Tone from 'tone';
import * as THREE from 'three';
import { db, handleFirestoreError, OperationType } from './lib/firebase';
import { doc, onSnapshot, setDoc, getDocFromServer } from 'firebase/firestore';
import { Camera, CameraOff } from 'lucide-react';

export default function App() {
  const { isStarted, startAudio, triggerNote, setMusicEvolution, evolution, getAudioData } = useAudio();
  const { isHandOpen, hasHandDetected, isCameraActive, startCamera, stopCamera } = useHandTracking();
  const [audioData, setAudioData] = useState(new Float32Array(1024));
  const [activeNodes, setActiveNodes] = useState<string[]>([]);
  const [interactionPoint, setInteractionPoint] = useState<THREE.Vector3 | null>(null);
  const [mode, setMode] = useState<'idle' | 'interaction' | 'flow' | 'climax'>('idle');
  const [intensity, setIntensity] = useState(0);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'error' | 'connecting'>('connecting');
  const intensityRef = useRef(0);
  const requestRef = useRef<number>(null);

  // Connectivity check
  const checkConnection = useCallback(async () => {
    setConnectionStatus('connecting');
    try {
      const stateRef = doc(db, 'global', 'state');
      await getDocFromServer(stateRef);
      setConnectionStatus('connected');
    } catch (err) {
      console.error("Connection failed:", err);
      // Wait a bit and retry once before showing error
      setTimeout(async () => {
        try {
          await getDocFromServer(doc(db, 'global', 'state'));
          setConnectionStatus('connected');
        } catch {
          setConnectionStatus('error');
        }
      }, 2000);
    }
  }, []);
  const lastSyncTimeRef = useRef<number>(Date.now());
  const clientId = useRef(Math.random().toString(36).substring(7));

  useEffect(() => {
    checkConnection();
    const unsub = onSnapshot(doc(db, 'global', 'state'), (snapshot) => {
      if (snapshot.exists()) {
        setConnectionStatus('connected');
        const data = snapshot.data();
        
        // Sync evolution
        if (typeof data.evolution === 'number') {
           setMusicEvolution(data.evolution);
        }

        // Sync mode
        if (data.mode) setMode(data.mode);

        // Sync intensity
        if (typeof data.intensity === 'number') {
          intensityRef.current = data.intensity;
          setIntensity(data.intensity);
        }

        // Sync interaction point
        if (data.lastInteraction && data.lastInteraction.timestamp > lastSyncTimeRef.current) {
          lastSyncTimeRef.current = data.lastInteraction.timestamp;
          const point = new THREE.Vector3(data.lastInteraction.x, data.lastInteraction.y, data.lastInteraction.z);
          setInteractionPoint(point);
          triggerNote("C3");
        }

        // Sync active nodes
        if (data.activeNodes) setActiveNodes(data.activeNodes);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'global/state');
    });

    return () => unsub();
  }, [triggerNote, setMusicEvolution]);

  const syncToFirebase = useCallback(async (updates: any) => {
    try {
      await setDoc(doc(db, 'global', 'state'), updates, { merge: true });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'global/state');
    }
  }, []);

  // Animation frame for audio visualizer data and intensity decay
  const animate = useCallback(() => {
    setAudioData(getAudioData());
    
    // Decay intensity - slower decay for more "lingering" feel
    intensityRef.current = Math.max(0, intensityRef.current - 0.005);
    setIntensity(intensityRef.current);

    requestRef.current = requestAnimationFrame(animate);
  }, [getAudioData]);

  useEffect(() => {
    if (isStarted || true) { // Always run for intensity tracking on splash
      requestRef.current = requestAnimationFrame(animate);
    }
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [isStarted, animate]);

  const handleSplashPointerDown = async (e: React.PointerEvent) => {
    // Capture rect synchronously before any await
    const target = e.currentTarget as HTMLElement;
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const clientX = e.clientX;
    const clientY = e.clientY;

    // Start audio on first interaction if not yet started
    if (!isStarted) {
      await startAudio();
    }
    
    await Tone.start();
    const notes = ["D4", "E4", "F#4", "A4", "B4", "D5", "E5", "A5"];
    triggerNote(notes[Math.floor(Math.random() * notes.length)]);
    
    const point = new THREE.Vector3(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
      0
    ).multiplyScalar(14);
    
    setInteractionPoint(point);
    setMode('interaction');

    const newIntensity = Math.min(1, intensityRef.current + 0.25);
    const newEvolution = Math.min(1, evolution + 0.05);
    intensityRef.current = newIntensity;
    setMusicEvolution(newEvolution);

    syncToFirebase({
      lastInteraction: { x: point.x, y: point.y, z: point.z, timestamp: Date.now() },
      intensity: newIntensity,
      evolution: newEvolution,
      mode: 'interaction'
    });
  };

  const handleSplashPointerMove = (e: React.PointerEvent) => {
    if (mode === 'interaction' && e.currentTarget) {
      const target = e.currentTarget as HTMLElement;
      const rect = target.getBoundingClientRect();
      const point = new THREE.Vector3(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
        0
      ).multiplyScalar(14);
      setInteractionPoint(point);
    }
  };

  const handleSplashPointerUp = () => {
    // Faster reset for better responsiveness
    setTimeout(() => {
      setInteractionPoint(null);
      setMode('idle');
    }, 100);
  };

  return (
    <div 
      className="fixed inset-0 bg-[#02040a] cursor-crosshair overflow-hidden select-none"
      onPointerDown={handleSplashPointerDown}
      onPointerMove={handleSplashPointerMove}
      onPointerUp={handleSplashPointerUp}
    >
      {/* Visual Canvas Layer */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <Canvas camera={{ position: [0, 0, 15], fov: 60 }} dpr={[1, 2]} gl={{ antialias: false }}>
          <ambientLight intensity={0.5} />
          <ParticleScene 
            audioData={audioData} 
            interactionPoint={interactionPoint} 
            mode={evolution > 0.8 ? 'climax' : mode} 
            intensity={intensity}
            isStarted={true}
            isPaused={!isHandOpen}
          />
          <EffectComposer>
            <Bloom intensity={1.5 + intensity * 2} luminanceThreshold={0.2} luminanceSmoothing={0.9} />
          </EffectComposer>
        </Canvas>
      </div>

      {/* Interface Layer */}
      <div className="absolute inset-0 z-20 flex pointer-events-none">
        <div className="absolute top-6 left-6 pointer-events-auto">
          <button
            onClick={() => isCameraActive ? stopCamera() : startCamera()}
            className={`p-3 rounded-full border transition-all duration-500 backdrop-blur-md ${isCameraActive ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-400' : 'border-white/10 bg-white/5 text-white/40 hover:border-white/20 hover:bg-white/10'}`}
          >
            {isCameraActive ? <Camera size={18} /> : <CameraOff size={18} />}
          </button>
          
          {isCameraActive && (
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="mt-3 px-3 py-1 bg-black/40 border border-white/10 rounded font-mono text-[8px] uppercase tracking-widest text-white/60"
            >
              System: {hasHandDetected ? (isHandOpen ? 'Open / 展开' : 'Closed / 握紧 (PAUSED)') : 'Searching for hand... / 搜寻手部...'}
            </motion.div>
          )}
        </div>
      </div>

      {/* Minimal Sync Status Overlay */}
      {connectionStatus === 'error' && (
        <div className="absolute bottom-4 right-4 text-[8px] font-mono text-red-500/40 uppercase tracking-widest animate-pulse pointer-events-none">
          Sync_Offline
        </div>
      )}
      {/* Particles Control Indicator */}
      <div className="fixed bottom-6 right-6 flex flex-col items-end gap-2 pointer-events-none z-50">
        <div className={`px-3 py-1.5 rounded-full text-[10px] font-mono tracking-widest uppercase transition-all duration-500 border ${
          isCameraActive ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400' : 'bg-gray-900/50 border-white/5 text-white/20'
        }`}>
          {isCameraActive ? (
            <span className="flex items-center gap-2">
              <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${hasHandDetected ? 'bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]' : 'bg-gray-600'}`} />
              Motion: {hasHandDetected ? (isHandOpen ? 'Tracking' : 'Paused') : 'Scanning...'}
            </span>
          ) : (
            'Camera Offline'
          )}
        </div>
      </div>
    </div>
  );
}
